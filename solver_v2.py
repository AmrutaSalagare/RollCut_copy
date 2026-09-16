# -*- coding: utf-8 -*-
"""
solver_v2.py - High-Yield ML-Driven Cutting Stock Solver
========================================================
- Model 1 (combo_generator): Decides optimal widths + quantities to cut.
- Strict Per-Roll 0% Waste Tiering: Any exact 0% waste cut receives absolute Tier 0 priority.
- Unrestricted Customer Widths: Evaluates arbitrary number of customer widths without 5-slot ceiling.
- ML-Guided Beam Search: Explores multi-roll trajectories to avoid greedy dead-ends.
"""

import pandas as pd
import numpy as np
import joblib
from collections import Counter

MODEL_PATH = "cutting_stock_model_v2.pkl"


# -----------------------------------------------------------
# 1. LOAD MODELS
# -----------------------------------------------------------

def load_models(path=MODEL_PATH):
    p = joblib.load(path)
    # Model 1 (combo_generator) is the core decision engine.
    # Returns 5 elements for backwards compatibility across existing scripts.
    return (
        p["combo_generator"],
        p.get("waste_scorer"),
        p["pool_features"],
        p.get("target_cols"),
        p.get("scorer_features")
    )


# -----------------------------------------------------------
# 2. CANDIDATE EVALUATION & SCORING
# -----------------------------------------------------------

def score_candidate(c):
    """
    Evaluates pattern quality with strict industrial manufacturability priority:
      Tier 0: Exact 0% waste (0mm scrap). Absolute top priority on this roll.
              Tie-breaker 1: Maximum material used (-used_mm)
              Tie-breaker 2: Minimum distinct widths (knife setup positions / blade adjustments)
              Tie-breaker 3: Minimum total slit cuts (fewer blades engaged on web)
              Tie-breaker 4: Largest individual cut width (-max_cut_width, favors wide stable cuts)
      Tier 1: High Yield (waste < 500mm). Lowest waste percentage wins!
              Tie-breaker: lowest waste_pct, fewer distinct widths, fewer total cuts, higher used_mm.
      Tier 2: Large remnant leftover (waste >= 500mm).
              Tie-breaker: higher used_mm, fewer distinct widths, fewer total cuts.
    """
    waste_mm = c.get("waste_mm", 0)
    waste_pct = c.get("waste_pct", 0.0)
    used_mm = c.get("used_mm", 0)
    counts = c.get("combo_counts", {})

    n_distinct_widths = len(counts)
    total_cuts = sum(counts.values()) if counts else 0
    max_cut_width = max(counts.keys()) if counts else 0

    # Tier 0: Exact 0% waste (0mm scrap) - Absolute top priority
    # Uniform/low-knife cuts (e.g. 700x3) decisively defeat fragmented cuts (e.g. 700x1, 540x1, 280x2, 150x2)
    if waste_mm == 0 or waste_pct <= 0.001:
        return (0, -used_mm, n_distinct_widths, total_cuts, -max_cut_width)

    # Tier 1: High Yield (waste < 500mm). Lowest waste percentage wins!
    elif waste_mm < 500:
        return (1, waste_pct, n_distinct_widths, total_cuts, -used_mm)

    # Tier 2: Large remnant leftover (waste >= 500mm).
    else:
        return (2, -used_mm, waste_mm, n_distinct_widths, total_cuts)


def rank_candidates(candidates):
    """Sort candidates by strict per-roll priority."""
    return sorted(candidates, key=score_candidate)


# -----------------------------------------------------------
# 3. ML COMBO GENERATOR (Unrestricted Customer Widths)
# -----------------------------------------------------------

def ml_generate_candidates(roll_width, pool, scenario_widths, gen_model, pool_features):
    """
    ML Model 1 predicts what widths + quantities to assign to this roll.
    Supports arbitrary number of customer widths in the pool:
      - Uses sliding windows so all widths are evaluated by ML.
      - Fallback seeds generated for all active pool widths.
      - Iterative gap-fill packs remaining space with any available width.
    """
    active = [(w, pool.get(w, 0)) for w in scenario_widths if pool.get(w, 0) > 0]
    if not active:
        return []

    # Build windows of widths to pass through the ML model
    # Window 1: Top volume (total mm) + smallest width
    windows = []
    top4 = sorted(active, key=lambda x: x[0] * x[1], reverse=True)[:4]
    top4_widths = {w for w, _ in top4}
    small = min(active, key=lambda x: x[0]) if active else None
    if small and small[0] not in top4_widths:
        w1 = top4 + [small]
    else:
        w1 = sorted(active, key=lambda x: x[0] * x[1], reverse=True)[:5]
    windows.append(w1)

    # Window 2: Divisibility & best fit for this roll width (if pool has > 5 widths)
    if len(active) > 5:
        w2 = sorted(active, key=lambda x: (roll_width % x[0], -x[0]))[:5]
        if {x[0] for x in w2} != {x[0] for x in w1}:
            windows.append(w2)

    seen = set()
    result = []

    def trim_to_fit(slots, qtys):
        """Reduce quantities until combo fits within roll_width."""
        used = sum(slots[i][0] * qtys[i] for i in range(5) if slots[i][0])
        q = list(qtys)
        for i in range(4, -1, -1):
            while used > roll_width and q[i] > 0:
                used -= slots[i][0]
                q[i] -= 1
        for i in range(5):
            while used > roll_width and q[i] > 0:
                used -= slots[i][0]
                q[i] -= 1
        return q

    def add_from_counts(counts):
        used = sum(w * q for w, q in counts.items())
        if used <= 0 or used > roll_width:
            return
        key = tuple(sorted(counts.items()))
        if key in seen:
            return
        seen.add(key)
        waste = roll_width - used
        result.append({
            "combo_counts": dict(counts),
            "used_mm": used,
            "waste_mm": waste,
            "waste_pct": round(waste / roll_width * 100, 2)
        })

    # Run ML inference on windows
    for win in windows:
        slots = win + [(0, 0)] * (5 - len(win))
        total_rem = sum(w * q for w, q in active)
        widths_rem = [w for w, q in active]
        avg_w = sum(widths_rem) / len(widths_rem) if widths_rem else 0

        feat_row = {"roll_width": roll_width}
        for i, (w, q) in enumerate(slots, 1):
            feat_row[f"pool_cust{i}_width"] = w
            feat_row[f"pool_cust{i}_remaining"] = q
            feat_row[f"pool_cust{i}_mm_left"] = w * q

        feat_row.update({
            "pool_total_remaining_mm": total_rem,
            "pool_n_widths": len(active),
            "pool_utilization": min(total_rem / roll_width, 5.0) if roll_width else 0,
            "pool_max_width": max(widths_rem) if widths_rem else 0,
            "pool_min_width": min(widths_rem) if widths_rem else 0,
            "pool_avg_width": avg_w,
            "pool_std_width": (sum((w - avg_w)**2 for w in widths_rem) / len(widths_rem)) ** 0.5
                               if len(widths_rem) > 1 else 0,
        })

        X = pd.DataFrame([[feat_row[f] for f in pool_features]], columns=pool_features)
        raw_preds = gen_model.predict(X)[0]

        base_qtys = [
            int(min(max(round(raw_preds[i]), 0), slots[i][1]))
            for i in range(5)
        ]

        # 1. Base ML prediction
        fitted = trim_to_fit(slots, base_qtys)
        counts = {slots[i][0]: fitted[i] for i in range(5) if slots[i][0] and fitted[i] > 0}
        add_from_counts(counts)

        # 2. Local +/- 1 variations
        for i in range(5):
            for delta in (-1, 1):
                varied = base_qtys.copy()
                varied[i] = max(0, min(base_qtys[i] + delta, slots[i][1]))
                fitted_v = trim_to_fit(slots, varied)
                counts_v = {slots[i][0]: fitted_v[i] for i in range(5) if slots[i][0] and fitted_v[i] > 0}
                add_from_counts(counts_v)

    # 3. Fallback: single-width fill for ALL active widths in pool (no 5-slot ceiling)
    for w, q in active:
        if w <= roll_width and q > 0:
            max_q = min(q, roll_width // w)
            if max_q > 0:
                add_from_counts({w: max_q})

    # 4. Iterative gap-fill: fill gaps with ANY width in pool
    def iterative_fill(counts):
        while True:
            used = sum(w * q for w, q in counts.items())
            gap = roll_width - used
            if gap <= 0:
                break
            improved = False
            for pw in sorted(pool.keys()):
                if pw > gap:
                    continue
                already = counts.get(pw, 0)
                extra = min(pool[pw] - already, gap // pw)
                if extra > 0:
                    counts = {**counts, pw: already + extra}
                    improved = True
                    break
            if not improved:
                break
        return counts

    for cand in list(result):
        filled = iterative_fill(dict(cand["combo_counts"]))
        add_from_counts(filled)

    return result


# -----------------------------------------------------------
# 4. MAIN SOLVE ENGINE (ML-Guided Beam Search)
# -----------------------------------------------------------

def solve(roll_widths, orders, gen_model, pool_features, roll_inventory=None, return_inventory=False, beam_width=3):
    """
    Solves 1D cutting stock using ML-guided search.
    Supports finite warehouse stock and prioritizes exact per-roll 0% waste.
    If beam_width > 1, explores multi-roll trajectories to avoid greedy dead-ends.
    """
    remaining = {}
    for w, q in orders:
        if q > 0:
            remaining[w] = remaining.get(w, 0) + q
    scenario_widths = list(remaining.keys())

    valid_roll_widths = sorted([rw for rw in roll_widths if rw > 0], reverse=True)

    # Initialize warehouse master roll stock: None/<=0 means unlimited (float('inf'))
    stock = {}
    if roll_inventory is not None:
        if isinstance(roll_inventory, dict):
            for rw in valid_roll_widths:
                qty = roll_inventory.get(rw)
                stock[rw] = float('inf') if qty is None or qty < 0 else int(qty)
        elif isinstance(roll_inventory, (list, tuple)):
            inv_dict = dict(roll_inventory)
            for rw in valid_roll_widths:
                qty = inv_dict.get(rw)
                stock[rw] = float('inf') if qty is None or qty < 0 else int(qty)
    else:
        for rw in valid_roll_widths:
            stock[rw] = float('inf')

    initial_state = {
        "plan": [],
        "remaining": dict(remaining),
        "stock": dict(stock),
        "total_waste_mm": 0,
        "total_used_mm": 0,
        "zero_waste_count": 0,
        "roll_num": 0
    }

    if beam_width <= 1:
        # Fast greedy path
        curr = initial_state
        while any(q > 0 for q in curr["remaining"].values()):
            pool = {w: q for w, q in curr["remaining"].items() if q > 0}
            if not pool:
                break
            min_pool_w = min(pool.keys())
            usable_rolls = [
                rw for rw in valid_roll_widths
                if rw >= min_pool_w and curr["stock"].get(rw, float('inf')) > 0
            ]
            if not usable_rolls:
                break

            best_roll, best, best_trials = None, None, []
            for rw in usable_rolls:
                cands = ml_generate_candidates(rw, pool, scenario_widths, gen_model, pool_features)
                ranked = sorted(cands, key=score_candidate)
                if ranked:
                    c = ranked[0]
                    if best is None or score_candidate(c) < score_candidate(best):
                        best_roll, best = rw, c
                        best_trials = ranked

            if not best or not best.get("combo_counts"):
                break

            max_repeats_orders = min(curr["remaining"][w] // q for w, q in best["combo_counts"].items() if q > 0)
            max_repeats_stock = curr["stock"].get(best_roll, float('inf'))
            if max_repeats_stock <= 0:
                break

            repeats = max(1, int(min(max_repeats_orders, max_repeats_stock)))
            for _ in range(repeats):
                curr["roll_num"] += 1
                curr["plan"].append({
                    "roll_num": curr["roll_num"], "roll_width": best_roll,
                    "cuts": dict(best["combo_counts"]),
                    "used_mm": best["used_mm"], "waste_mm": best["waste_mm"],
                    "waste_pct": best["waste_pct"],
                    "efficiency_pct": round(100 - best["waste_pct"], 2),
                    "candidates_explored": [
                        {
                            "pattern": ", ".join(f"{w}mm x{q}" for w, q in sorted(cand["combo_counts"].items(), reverse=True)),
                            "cuts": dict(cand["combo_counts"]),
                            "used_mm": cand["used_mm"],
                            "waste_mm": cand["waste_mm"],
                            "waste_pct": cand["waste_pct"],
                            "efficiency_pct": round(100 - cand["waste_pct"], 2),
                            "is_chosen": (cand["combo_counts"] == best["combo_counts"])
                        }
                        for cand in best_trials
                    ]
                })

            if curr["stock"].get(best_roll) != float('inf'):
                curr["stock"][best_roll] = max(0, curr["stock"][best_roll] - repeats)

            for w, q in best["combo_counts"].items():
                curr["remaining"][w] = max(0, curr["remaining"][w] - (q * repeats))

        best_state = curr
    else:
        # Beam search path
        beam = [initial_state]
        completed = []

        max_steps = 80
        step = 0
        while beam and step < max_steps:
            step += 1
            next_beam = []
            any_progress = False

            for state in beam:
                pool = {w: q for w, q in state["remaining"].items() if q > 0}
                if not pool:
                    completed.append(state)
                    continue

                min_pool_w = min(pool.keys())
                usable_rolls = [
                    rw for rw in valid_roll_widths
                    if rw >= min_pool_w and state["stock"].get(rw, float('inf')) > 0
                ]
                if not usable_rolls:
                    completed.append(state)
                    continue

                # Collect candidate actions for this state
                roll_actions = []
                for rw in usable_rolls:
                    cands = ml_generate_candidates(rw, pool, scenario_widths, gen_model, pool_features)
                    ranked = sorted(cands, key=score_candidate)
                    # Take top 2 distinct patterns per roll width for beam diversity
                    for c in ranked[:2]:
                        roll_actions.append((rw, c, ranked))

                if not roll_actions:
                    completed.append(state)
                    continue

                # Sort actions by per-roll score
                roll_actions.sort(key=lambda item: score_candidate(item[1]))

                # Branch on the top actions (up to 3 best actions)
                for rw, c, trials in roll_actions[:3]:
                    max_repeats_orders = min(state["remaining"][w] // q for w, q in c["combo_counts"].items() if q > 0)
                    max_repeats_stock = state["stock"].get(rw, float('inf'))
                    if max_repeats_stock <= 0:
                        continue
                    repeats = max(1, int(min(max_repeats_orders, max_repeats_stock)))

                    new_plan = list(state["plan"])
                    r_num = state["roll_num"]
                    for _ in range(repeats):
                        r_num += 1
                        new_plan.append({
                            "roll_num": r_num, "roll_width": rw,
                            "cuts": dict(c["combo_counts"]),
                            "used_mm": c["used_mm"], "waste_mm": c["waste_mm"],
                            "waste_pct": c["waste_pct"],
                            "efficiency_pct": round(100 - c["waste_pct"], 2),
                            "candidates_explored": [
                                {
                                    "pattern": ", ".join(f"{w}mm x{q}" for w, q in sorted(cand["combo_counts"].items(), reverse=True)),
                                    "cuts": dict(cand["combo_counts"]),
                                    "used_mm": cand["used_mm"],
                                    "waste_mm": cand["waste_mm"],
                                    "waste_pct": cand["waste_pct"],
                                    "efficiency_pct": round(100 - cand["waste_pct"], 2),
                                    "is_chosen": (cand["combo_counts"] == c["combo_counts"])
                                }
                                for cand in trials
                            ]
                        })

                    new_stock = dict(state["stock"])
                    if new_stock.get(rw) != float('inf'):
                        new_stock[rw] = max(0, new_stock[rw] - repeats)

                    new_remaining = dict(state["remaining"])
                    for w, q in c["combo_counts"].items():
                        new_remaining[w] = max(0, new_remaining[w] - (q * repeats))

                    is_zero_waste = (c["waste_mm"] == 0 or c["waste_pct"] <= 0.001)

                    child_state = {
                        "plan": new_plan,
                        "remaining": new_remaining,
                        "stock": new_stock,
                        "total_waste_mm": state["total_waste_mm"] + (c["waste_mm"] * repeats),
                        "total_used_mm": state["total_used_mm"] + (c["used_mm"] * repeats),
                        "zero_waste_count": state["zero_waste_count"] + (repeats if is_zero_waste else 0),
                        "roll_num": r_num
                    }
                    next_beam.append(child_state)
                    any_progress = True

            if not any_progress:
                completed.extend(beam)
                break

            # Prune next_beam down to beam_width
            def state_rank(s):
                rem_mm = sum(w * q for w, q in s["remaining"].items() if q > 0)
                plan_setups = sum(len(r["cuts"]) for r in s["plan"])
                plan_cuts = sum(sum(r["cuts"].values()) for r in s["plan"])
                return (
                    rem_mm,
                    -s["zero_waste_count"],
                    s["total_waste_mm"],
                    plan_setups,
                    plan_cuts,
                    -s["total_used_mm"]
                )

            next_beam.sort(key=state_rank)

            # Deduplicate by remaining pool profile
            deduped = []
            seen_rem = set()
            for s in next_beam:
                fp = tuple(sorted((w, q) for w, q in s["remaining"].items() if q > 0))
                if fp not in seen_rem:
                    seen_rem.add(fp)
                    deduped.append(s)
                if len(deduped) >= beam_width:
                    break
            beam = deduped

        all_candidates = completed + beam
        if not all_candidates:
            all_candidates = [initial_state]

        all_candidates.sort(key=lambda s: (
            sum(w * q for w, q in s["remaining"].items() if q > 0),
            -s["zero_waste_count"],
            s["total_waste_mm"],
            sum(len(r["cuts"]) for r in s["plan"]),
            sum(sum(r["cuts"].values()) for r in s["plan"]),
            len(s["plan"])
        ))
        best_state = all_candidates[0]

    plan = best_state["plan"]
    final_remaining = {w: q for w, q in best_state["remaining"].items() if q > 0}
    final_stock = {
        rw: None if best_state["stock"].get(rw) == float('inf') else best_state["stock"].get(rw)
        for rw in valid_roll_widths
    }

    if return_inventory:
        return plan, final_stock, final_remaining
    return plan


# -----------------------------------------------------------
# 5. OUTPUT FORMATTER
# -----------------------------------------------------------

def print_plan(plan):
    total_used = sum(r["used_mm"] for r in plan)
    total_waste = sum(r["waste_mm"] for r in plan)
    total_capacity = sum(r["roll_width"] for r in plan)
    eff = round(total_used / total_capacity * 100, 2) if total_capacity else 0

    print("\n" + "=" * 58)
    print("          ROLL CUTTING PLAN  [ML-Driven]")
    print("=" * 58)
    for r in plan:
        cuts = ", ".join(f"{w}mm x{q}" for w, q in sorted(r["cuts"].items(), reverse=True))
        print(f"\n  Roll #{r['roll_num']}  [{r['roll_width']}mm roll]")
        print(f"    Cuts       : {cuts}")
        print(f"    Used       : {r['used_mm']}mm  |  Waste: {r['waste_mm']}mm  |  Efficiency: {r['efficiency_pct']}%")

    print("\n" + "-" * 58)
    print(f"  Rolls used         : {len(plan)}")
    print(f"  Total capacity     : {total_capacity}mm")
    print(f"  Total used         : {total_used}mm")
    print(f"  Total waste        : {total_waste}mm")
    print(f"  Overall efficiency : {eff}%")
    print("=" * 58)


# -----------------------------------------------------------
# 6. QUICK TEST
# -----------------------------------------------------------

if __name__ == "__main__":
    gen_model, _, pool_feats, _, _ = load_models()

    ROLL_WIDTHS = [3000, 2500, 2800]
    ORDERS = [(500, 5), (700, 3), (300, 4), (600, 2)]

    print("Orders:")
    for w, q in ORDERS:
        print(f"  {w}mm x {q}")
    print("Available rolls:", ROLL_WIDTHS)

    plan = solve(ROLL_WIDTHS, ORDERS, gen_model, pool_feats, beam_width=3)
    print_plan(plan)
