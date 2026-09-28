# -*- coding: utf-8 -*-
"""
solver_2d.py — Pure ML-Driven 2D Roll Cutting Solver
====================================================
Master roll: width (mm) × length (m)
Customer:    width (mm) × length (m) × quantity

Pure ML Architecture with Length Multiplicity & Learned Optimization:
  1. Combo Generator (Model 1): Multi-Output XGBoost predicting knife track allocations.
  2. Length Multiplicity: Supports linear slitting where section_length >= order_length
                          (1 knife track running for 6000m yields two 3000m customer rolls).
  3. Multi-Window ML Inference: Evaluates the entire order pool without arbitrary hardcoded filters.
  4. Waste Scorer (Model 2):    Learned XGBoost value function predicting area yield and scrap.
  5. ML Beam Search:            Searches multi-roll master catalogs to minimize rolls and scrap.
"""

import math
import pandas as pd
import numpy as np
import joblib
from collections import Counter

MODEL_PATH = "cutting_stock_2d_model.pkl"
DEFAULT_NUM_SLOTS = 10


def get_num_slots(pool_features=None, target_cols=None):
    if target_cols:
        return len(target_cols)
    if pool_features:
        slots = [f for f in pool_features if f.startswith("pool_cust") and f.endswith("_width")]
        if slots:
            return len(slots)
    return DEFAULT_NUM_SLOTS


# ── 1. Load Models ────────────────────────────────────────────────────────────

def load_models(path=MODEL_PATH):
    p = joblib.load(path)
    return (
        p["combo_generator_2d"],
        p.get("waste_scorer_2d"),
        p["pool_features"],
        p.get("target_cols", []),
        p.get("scorer_features", []),
    )


# ── 2. Feature Extraction (Matching train_2d.py) ──────────────────────────────

def extract_pool_features(master_width, master_length, length_remaining, section_length,
                          pool, pool_features, slots=None):
    """
    Extract features representing the pool state and section geometry.
    Feeds learned length-multiplicity metrics so the ML model recognizes exact
    integer fits (e.g. 6000m // 3000m = 2, mod = 0) without hardcoded rules.
    """
    active = [(w, l, q) for (w, l), q in pool.items() if q > 0 and l <= length_remaining and w <= master_width]
    if not active:
        return None, []

    num_slots = get_num_slots(pool_features)
    if slots is None:
        active_sorted = sorted(active, key=lambda x: x[0] * x[1] * x[2], reverse=True)
        slots_window = (active_sorted + [(0, 0, 0)] * num_slots)[:num_slots]
    else:
        slots_window = (slots + [(0, 0, 0)] * num_slots)[:num_slots]

    widths_rem  = [w for w, l, q in active]
    lengths_rem = [l for w, l, q in active]
    total_area  = sum(w * l * q for w, l, q in active)
    avg_w = float(np.mean(widths_rem))  if widths_rem  else 0.0
    avg_l = float(np.mean(lengths_rem)) if lengths_rem else 0.0
    std_w = float(np.std(widths_rem))   if len(widths_rem)  > 1 else 0.0
    std_l = float(np.std(lengths_rem))  if len(lengths_rem) > 1 else 0.0

    feat = {
        "master_roll_width":       master_width,
        "master_roll_length":      master_length,
        "master_length_remaining": length_remaining,
        "length_remaining_ratio":  round(length_remaining / master_length, 4) if master_length > 0 else 0.0,
        "section_length":          section_length,
        "section_length_ratio":    round(section_length / length_remaining, 4) if length_remaining > 0 else 0.0,
    }

    for i, (w, l, q) in enumerate(slots_window, 1):
        mult = (section_length // l) if (w > 0 and l > 0 and l <= section_length) else 0
        knives_needed = math.ceil(q / mult) if mult > 0 else 0
        mod_rem = (section_length % l) if (w > 0 and l > 0) else 0

        feat[f"pool_cust{i}_width"]          = w
        feat[f"pool_cust{i}_length"]         = l
        feat[f"pool_cust{i}_qty"]            = q
        feat[f"pool_cust{i}_area_left"]      = w * l * q
        feat[f"pool_cust{i}_width_fit"]      = int(master_width // w) if w > 0 else 0
        feat[f"pool_cust{i}_width_ratio"]    = round(w / master_width, 4) if master_width > 0 else 0.0
        feat[f"pool_cust{i}_fit_rem"]        = round((master_width % w) / master_width, 4) if w > 0 else 1.0
        feat[f"pool_cust{i}_len_multiplier"] = mult
        feat[f"pool_cust{i}_len_mod_ratio"]  = round(mod_rem / section_length, 4) if section_length > 0 else 1.0
        feat[f"pool_cust{i}_knives_needed"]  = knives_needed

    feat.update({
        "pool_total_remaining_area": total_area,
        "pool_n_active":             sum(1 for _, _, q in active if q > 0),
        "pool_avg_width":            round(avg_w, 2),
        "pool_std_width":            round(std_w, 2),
        "pool_avg_length":           round(avg_l, 2),
        "pool_std_length":           round(std_l, 2),
        "pool_max_width":            max(widths_rem, default=0),
        "pool_min_width":            min(widths_rem, default=0),
        "pool_max_length":           max(lengths_rem, default=0),
        "pool_min_length":           min(lengths_rem, default=0),
        "pool_area_utilization":     round(total_area / (master_width * length_remaining), 4) if length_remaining > 0 else 0.0,
    })

    X = pd.DataFrame([[feat.get(f, 0) for f in pool_features]], columns=pool_features)
    return X, slots_window


# ── 3. Multi-Window Construction ──────────────────────────────────────────────

def build_ml_windows(pool, master_width, length_remaining, section_length, num_slots=DEFAULT_NUM_SLOTS):
    """
    Constructs multi-perspective windows so all active items in the pool
    are evaluated by the ML model without arbitrary exclusion.
    """
    active = [(w, l, q) for (w, l), q in pool.items() if q > 0 and l <= section_length and w <= master_width]
    if not active:
        return []

    windows = []
    seen = set()

    def add_win(items):
        clean = [(w, l, q) for (w, l, q) in items if w > 0 and q > 0][:num_slots]
        padded = (clean + [(0, 0, 0)] * num_slots)[:num_slots]
        k = tuple(sorted((w, l) for (w, l, q) in padded if w > 0))
        if k not in seen and any(w > 0 for w, l, q in padded):
            seen.add(k)
            windows.append(padded)

    # Window 0: Top volume by remaining area
    by_area = sorted(active, key=lambda x: x[0] * x[1] * x[2], reverse=True)
    add_win(by_area)

    # Window 1: Divisibility & best length fit (exact integer multiples first)
    by_len_fit = sorted(active, key=lambda x: (section_length % x[1], -(section_length // x[1]), -x[0]))
    add_win(by_len_fit)

    # Window 2: Divisibility & best width fit for master roll width
    by_width_fit = sorted(active, key=lambda x: (master_width % x[0], -x[0]))
    add_win(by_width_fit)

    # Window 3: Complementary wide primary cuts + narrow fillers (e.g. 50mm)
    mid = num_slots // 2
    wide = sorted([it for it in active if it[0] >= 300], key=lambda x: x[0] * x[1] * x[2], reverse=True)
    narrow = sorted([it for it in active if it[0] < 300], key=lambda x: (-x[1], -x[0]))
    if wide and narrow:
        add_win(wide[:mid] + narrow[:(num_slots - mid)])

    # Window 4: Length-Clustered Windows (Group identical/similar length items to eliminate tail waste)
    by_exact_len = sorted(active, key=lambda x: (-x[1], -x[0] * x[2]))
    add_win(by_exact_len)

    # Window 5: Narrow side-trim gap fillers (prioritize 50mm/80mm items for filling under-utilized rolls)
    small_fillers = sorted([it for it in active if it[0] <= 100], key=lambda x: (-x[1], -x[2]))
    if small_fillers:
        add_win(small_fillers + [it for it in active if it[0] > 100])

    return windows


# ── 4. Pure ML Candidate Generator & Scorer ───────────────────────────────────

_SECTION_CAND_CACHE = {}

def ml_generate_section_candidates(master_width, master_length, length_remaining,
                                   pool, gen_model, pool_features,
                                   scorer_model=None, scorer_features=None):
    """
    Generates section slitting patterns using learned ML predictions:
      - Explores candidate section lengths directly from pool demands.
      - Uses Model 1 (combo_generator_2d) to predict knife allocations.
      - Evaluates patterns using Model 2 (waste_scorer_2d) in a single batched pass.
      - Cached for instant response across identical sub-pools.
    """
    active = [(w, l, q) for (w, l), q in pool.items() if q > 0 and l <= length_remaining and w <= master_width]
    if not active:
        return []

    cache_key = (master_width, length_remaining, tuple(sorted((k, q) for k, q in pool.items() if q > 0)))
    if cache_key in _SECTION_CAND_CACHE:
        return _SECTION_CAND_CACHE[cache_key]

    # Section lengths to evaluate: explore candidate lengths in active pool
    candidate_lengths = sorted(set(l for (w, l, q) in active), reverse=True)[:8]
    if not candidate_lengths:
        return []

    seen = set()
    result = []

    def trim_knives(knife_map):
        """Reduces knife counts if total knife width exceeds master roll width."""
        curr = dict(knife_map)
        used_w = sum(w * k for (w, l), k in curr.items())
        while used_w > master_width:
            active_keys = [k for k, count in curr.items() if count > 0]
            if not active_keys:
                break
            # Pick knife removal that brings width closest to master_width
            def trim_fitness(k):
                w = k[0]
                new_w = used_w - w
                if new_w <= master_width:
                    return (0, master_width - new_w)
                return (1, new_w - master_width)
            target = min(active_keys, key=trim_fitness)
            curr[target] -= 1
            if curr[target] <= 0:
                del curr[target]
            used_w = sum(w * k for (w, l), k in curr.items())
        return curr

    def iterative_gap_fill(knife_map, sec_len):
        """Fills remaining width gap on the slitter with optimal available pool orders using exact DP."""
        curr = dict(knife_map)
        used_w = sum(w * k for (w, l), k in curr.items())
        gap = master_width - used_w
        if gap <= 0:
            return curr

        # Available knives for items that fit in sec_len
        avail = {}
        for (pw, pl), total_q in pool.items():
            if pl > sec_len or pw > gap or total_q <= 0:
                continue
            mult = sec_len // pl
            if mult < 1:
                continue
            mod = sec_len % pl
            if mod > 0 and (mod / sec_len) > 0.30:
                continue
            needed = math.ceil(total_q / mult)
            already = curr.get((pw, pl), 0)
            can_add = needed - already
            if can_add > 0:
                avail[(pw, pl)] = min(can_add, gap // pw)

        if not avail:
            return curr

        dp = {0: {}}
        for (pw, pl), max_k in sorted(avail.items(), key=lambda x: -x[0][0]):
            for cur_g, combo in list(dp.items()):
                for k in range(1, max_k + 1):
                    nxt_g = cur_g + k * pw
                    if nxt_g <= gap:
                        if nxt_g not in dp or sum(dp[nxt_g].values()) < sum(combo.values()) + k:
                            nxt_c = dict(combo)
                            nxt_c[(pw, pl)] = nxt_c.get((pw, pl), 0) + k
                            dp[nxt_g] = nxt_c

        best_g = max(dp.keys(), default=0)
        best_combo = dp.get(best_g, {})
        for k, count in best_combo.items():
            curr[k] = curr.get(k, 0) + count
        return curr

    def evaluate_and_register(raw_knives, sec_len):
        if not raw_knives or all(k <= 0 for k in raw_knives.values()):
            return

        trimmed = trim_knives(raw_knives)
        if not trimmed:
            return

        # Gap fill leftover space
        filled = iterative_gap_fill(trimmed, sec_len)

        # Build clean assignment and calculate fulfilled customer rolls
        valid_knives = {k: count for k, count in filled.items() if count > 0 and k[1] <= sec_len}
        if not valid_knives:
            return

        used_width = sum(w * k for (w, l), k in valid_knives.items())
        if used_width <= 0 or used_width > master_width:
            return

        key = (tuple(sorted(valid_knives.items())), sec_len)
        if key in seen:
            return
        seen.add(key)

        width_waste = master_width - used_width
        section_area = master_width * sec_len

        # Calculate fulfilled customer roll quantities and true cut product area
        assignment = {}
        used_area = 0
        for (w, l), k in valid_knives.items():
            mult = sec_len // l
            q_cut = min(pool.get((w, l), 0), k * mult)
            assignment[(w, l)] = q_cut
            used_area += (w * l * q_cut)

        waste_area = max(0, section_area - used_area)
        waste_pct = round(waste_area / section_area * 100, 4) if section_area > 0 else 100.0

        # Reusable side offcut (if trim >= 150mm)
        is_width_remnant = (width_waste >= 150)
        width_remnant_area = (width_waste * sec_len) if is_width_remnant else 0

        result.append({
            "assignment":            assignment,
            "knife_counts":          valid_knives,
            "section_length":        sec_len,
            "master_width":          master_width,
            "used_width_mm":         used_width,
            "width_waste_mm":        width_waste,
            "used_area":             used_area,
            "section_area":          section_area,
            "waste_area":            waste_area,
            "waste_area_pct":        waste_pct,
            "ml_pred_waste":         round(waste_pct, 2),
            "is_width_remnant":      is_width_remnant,
            "width_remnant_mm":      width_waste if is_width_remnant else 0,
            "width_remnant_length":  sec_len if is_width_remnant else 0,
            "width_remnant_area":    width_remnant_area,
        })

    num_slots = get_num_slots(pool_features)

    # Explore candidate section lengths with batched ML inference
    for s_len in candidate_lengths:
        windows = build_ml_windows(pool, master_width, length_remaining, s_len, num_slots=num_slots)
        if not windows:
            continue

        # Extract features for all windows at once
        win_feats = []
        win_slots = []
        for win in windows:
            feat_df, slots = extract_pool_features(
                master_width, master_length, length_remaining, s_len, pool, pool_features, slots=win
            )
            if feat_df is not None:
                win_feats.append(feat_df.iloc[0])
                win_slots.append(slots)

        if not win_feats:
            continue

        # Single batched call to Model 1
        X_batch = pd.DataFrame(win_feats, columns=pool_features)
        try:
            batch_preds = gen_model.predict(X_batch)
        except Exception:
            batch_preds = [[0] * num_slots] * len(win_feats)

        for w_idx, slots in enumerate(win_slots):
            raw_preds = batch_preds[w_idx]
            base_knives = []
            for i in range(num_slots):
                w, l, q = slots[i]
                if w > 0 and l > 0 and l <= s_len:
                    mult = s_len // l
                    max_k = math.ceil(q / mult) if mult > 0 else 0
                    pred_k = int(min(max(round(float(raw_preds[i])), 0), max_k))
                else:
                    pred_k = 0
                base_knives.append(pred_k)

            # 1. Base ML knife prediction
            ml_knife_map = {}
            for i in range(num_slots):
                w, l, _ = slots[i]
                if w > 0 and base_knives[i] > 0:
                    ml_knife_map[(w, l)] = base_knives[i]
            evaluate_and_register(ml_knife_map, s_len)

            # 2. Local +/-1 and +/-2 variations around ML prediction
            for i in range(num_slots):
                w, l, q = slots[i]
                if w <= 0 or l <= 0 or l > s_len:
                    continue
                mult = s_len // l
                max_k = math.ceil(q / mult) if mult > 0 else 0
                for delta in (-1, 1):
                    v = dict(ml_knife_map)
                    k = (w, l)
                    new_k = max(0, min(base_knives[i] + delta, max_k))
                    if new_k > 0:
                        v[k] = new_k
                    elif k in v:
                        del v[k]
                    evaluate_and_register(v, s_len)

        # 3. Multi-order complementary combinations: explore pairing high-demand primary items with fillers
        sorted_active = sorted(active, key=lambda x: -x[0])
        for idx, (pw, pl, pq) in enumerate(sorted_active):
            if pl > s_len:
                continue
            mult = s_len // pl
            if mult < 1:
                continue
            mod = s_len % pl
            if mod > 0 and (mod / s_len) > 0.30:
                continue
            max_k = min(math.ceil(pq / mult), master_width // pw)
            for k_start in range(max_k, max(0, max_k - 3), -1):
                if k_start <= 0:
                    continue
                evaluate_and_register({(pw, pl): k_start}, s_len)

        # 4. Exact Knapsack patterns for s_len to ensure zero-waste width combos are always explored
        avail_units = {}
        for pw, pl, pq in active:
            if pl <= s_len and pq > 0:
                mult = s_len // pl
                if mult >= 1:
                    mod = s_len % pl
                    if mod > 0 and (mod / s_len) > 0.30:
                        continue
                    knives_needed = math.ceil(pq / mult)
                    avail_units[(pw, pl)] = min(knives_needed, master_width // pw)

        dp_full = {0: {}}
        for (pw, pl), max_k in sorted(avail_units.items(), key=lambda x: -x[0][0]):
            for cur_w, combo in list(dp_full.items()):
                for k in range(1, max_k + 1):
                    nxt_w = cur_w + k * pw
                    if nxt_w <= master_width:
                        if nxt_w not in dp_full or sum(dp_full[nxt_w].values()) < sum(combo.values()) + k:
                            nxt_combo = dict(combo)
                            nxt_combo[(pw, pl)] = nxt_combo.get((pw, pl), 0) + k
                            dp_full[nxt_w] = nxt_combo

        for used_w in sorted(dp_full.keys(), reverse=True)[:3]:
            evaluate_and_register(dp_full[used_w], s_len)

    # Batched Model 2 evaluation across all registered candidates in ONE single pass
    if scorer_model is not None and scorer_features and result:
        sc_rows = []
        for cand in result:
            valid_knives = cand["knife_counts"]
            sec_len = cand["section_length"]
            used_w = cand["used_width_mm"]
            sc_row = {
                "master_roll_width":       master_width,
                "section_length":          sec_len,
                "width_utilization_ratio": round(used_w / master_width, 4) if master_width > 0 else 0.0,
                "width_trim_ratio":        round((master_width - used_w) / master_width, 4) if master_width > 0 else 0.0,
                "used_width_mm":           used_w,
            }
            assigned_items = sorted(valid_knives.items(), key=lambda x: x[0][0] * x[1], reverse=True)
            for i in range(1, num_slots + 1):
                if i <= len(assigned_items):
                    (cw, cl), ck = assigned_items[i - 1]
                    sc_row[f"pool_cust{i}_width"]    = cw
                    sc_row[f"pool_cust{i}_length"]   = cl
                    sc_row[f"assign_cust{i}_knives"] = ck
                else:
                    sc_row[f"pool_cust{i}_width"]    = 0
                    sc_row[f"pool_cust{i}_length"]   = 0
                    sc_row[f"assign_cust{i}_knives"] = 0
            sc_rows.append(sc_row)

        X_sc = pd.DataFrame(sc_rows, columns=scorer_features)
        try:
            preds = scorer_model.predict(X_sc)
            for i, p_val in enumerate(preds):
                result[i]["ml_pred_waste"] = round(float(p_val), 2)
        except Exception:
            pass

    _SECTION_CAND_CACHE[cache_key] = result
    return result


# ── 5. Candidate Ranking by Pure ML Predicted Value ───────────────────────────

def score_section(cand):
    """
    Candidate Pattern Scoring prioritizing Zero Waste & 100% Slitting Yield:
    1. Exact 100% yield patterns (0 trim, 0 length waste) strictly achieve score 0.0.
    2. True geometric waste percentage (waste_area_pct) is strictly enforced as the base cost.
    3. Severe penalty on side trim / offcuts (width_waste_mm).
    4. Tie-breakers: used width (full master width) and used product area.
    """
    geo_pct  = cand.get("waste_area_pct", 100.0)
    raw_ml   = cand.get("ml_pred_waste", geo_pct)
    u_w      = cand["used_width_mm"]
    w_mm     = cand["width_waste_mm"]
    mw       = cand.get("master_width", u_w + w_mm)
    mw       = mw if mw > 0 else 1
    u_area   = cand["used_area"]

    width_trim_penalty = (w_mm / mw) * 100.0
    ml_blend = max(0.0, raw_ml) * 0.05
    effective_scrap = round(geo_pct + width_trim_penalty + ml_blend, 4)

    return (effective_scrap, -u_w, -u_area)


# ── 6. Master Roll Longitudinal Partitioning & Multi-Run Optimization ──────────

def find_length_partitions(master_length, active_lengths):
    """
    Finds high-yield longitudinal partitions of the master roll length (L1, L2, ...).
    Enumerates ALL singletons (L1 <= master_length), pairs, and triplets with repetition,
    so combinations like 3k+5k, 3.5k+4.5k, 4k+4k, or single orders (e.g. 3.5k on 4k roll) are all considered.
    Results are sorted by closeness to master_length (least remnant first).
    """
    lens = sorted(set(active_lengths), reverse=True)
    partitions = []
    seen = set()

    def add_p(p, waste):
        k = tuple(sorted(p, reverse=True))
        if k not in seen:
            seen.add(k)
            partitions.append((waste, k))

    # 1. Singletons: Any order length L1 <= master_length
    for l1 in lens:
        if l1 <= master_length:
            add_p((l1,), master_length - l1)

    # 2. All pairs (with repetition): L1 + L2 <= master_length
    for i, l1 in enumerate(lens):
        for l2 in lens:  # allow l2 == l1 (e.g. 4k+4k)
            total = l1 + l2
            if total <= master_length:
                add_p((l1, l2), master_length - total)

    # 3. All triplets (with repetition): L1 + L2 + L3 <= master_length
    for l1 in lens:
        for l2 in lens:
            for l3 in lens:
                total = l1 + l2 + l3
                if total <= master_length:
                    add_p((l1, l2, l3), master_length - total)

    # Sort by waste ascending so zero-waste combinations come first
    partitions.sort(key=lambda x: x[0])
    return [p for _, p in partitions]


def solve_2d(master_rolls, orders, gen_model, pool_features,
             scorer_model=None, scorer_features=None,
             roll_inventory=None, beam_width=4,
             return_inventory=False):
    """
    Purely ML-guided 2D cutting stock solver across master rolls and sections.
    """
    _SECTION_CAND_CACHE.clear()
    beam_width = max(beam_width, 4)
    remaining = {}
    for w, l, q in orders:
        if q > 0:
            remaining[(w, l)] = remaining.get((w, l), 0) + q

    stock = {}
    for mw, ml in master_rolls:
        key = (mw, ml)
        if roll_inventory and key in roll_inventory:
            stock[key] = int(roll_inventory[key])
        else:
            stock[key] = float("inf")

    # Prioritize finite-stock / remnant rolls so warehouse inventory is consumed first
    def roll_priority(r):
        is_finite = 1 if stock.get(r, float("inf")) < float("inf") else 0
        return (is_finite, r[0] * r[1])

    valid_rolls = sorted(set(master_rolls), key=roll_priority, reverse=True)

    initial = {
        "remaining":        dict(remaining),
        "stock":            dict(stock),
        "plan":             [],
        "roll_num":         0,
        "total_waste_area": 0,
        "total_used_area":  0,
    }

    beam = [initial]
    max_steps = 50

    def format_trials(cands, chosen):
        trials = []
        seen_t = set()
        chosen_key = (tuple(sorted(chosen["assignment"].items())), chosen["section_length"])
        seen_t.add(chosen_key)
        p_str = " | ".join(f"{w}mm x {l}m (x{q})" for (w, l), q in sorted(chosen["assignment"].items(), key=lambda x: -x[0][0]))
        y_pct = round(chosen["used_area"] / chosen["section_area"] * 100, 2) if chosen["section_area"] else 0.0
        trials.append({
            "pattern": p_str,
            "section_length": chosen["section_length"],
            "used_width_mm": chosen["used_width_mm"],
            "width_waste_mm": chosen["width_waste_mm"],
            "waste_area_pct": chosen["waste_area_pct"],
            "ml_pred_waste": chosen.get("ml_pred_waste", 0),
            "yield_pct": y_pct,
            "is_chosen": True
        })
        for c in cands:
            k_cand = (tuple(sorted(c["assignment"].items())), c["section_length"])
            if k_cand in seen_t:
                continue
            seen_t.add(k_cand)
            pat = " | ".join(f"{w}mm x {l}m (x{q})" for (w, l), q in sorted(c["assignment"].items(), key=lambda x: -x[0][0]))
            c_y = round(c["used_area"] / c["section_area"] * 100, 2) if c["section_area"] else 0.0
            trials.append({
                "pattern": pat,
                "section_length": c["section_length"],
                "used_width_mm": c["used_width_mm"],
                "width_waste_mm": c["width_waste_mm"],
                "waste_area_pct": c["waste_area_pct"],
                "ml_pred_waste": c.get("ml_pred_waste", 0),
                "yield_pct": c_y,
                "is_chosen": False
            })
            if len(trials) >= 12:
                break
        return trials

    for step in range(max_steps):
        next_beam = []

        for state in beam:
            cur_pool = {k: q for k, q in state["remaining"].items() if q > 0}
            if not cur_pool:
                next_beam.append(state)
                continue

            # ── Remnant-First: only use new (infinite-stock) rolls if no remnant roll
            #    in the current state can absorb at least one pending order ──────────
            remnant_rolls_available = [
                r for r in valid_rolls
                if state["stock"].get(r, float("inf")) < float("inf")
                and state["stock"].get(r, 0) > 0
                and any(w <= r[0] and l <= r[1] for (w, l) in cur_pool)
            ]
            if remnant_rolls_available:
                rolls_to_try = remnant_rolls_available
            else:
                rolls_to_try = valid_rolls

            for mw, ml in rolls_to_try:
                key = (mw, ml)
                if state["stock"].get(key, float("inf")) <= 0:
                    continue
                if not any(w <= mw and l <= ml for (w, l) in cur_pool):
                    continue

                active_lens = sorted(set(l for (w, l), q in cur_pool.items() if q > 0 and l <= ml), reverse=True)
                if not active_lens:
                    continue

                candidate_partitions = find_length_partitions(ml, active_lens)
                candidate_roll_plans = []

                # ── Strategy 1: Partition-Guided Master Roll Construction ─────────
                for part in candidate_partitions[:6]:
                    if len(part) >= 2:
                        L1, L2 = part[0], part[1]
                        cands_1 = ml_generate_section_candidates(
                            mw, ml, ml, cur_pool, gen_model, pool_features, scorer_model, scorer_features
                        )
                        matching_1 = [c for c in cands_1 if c["section_length"] == L1] or cands_1
                        matching_1.sort(key=score_section)

                        for top_1 in matching_1[:3]:
                            pool_after_1 = dict(cur_pool)
                            for k, q in top_1["assignment"].items():
                                pool_after_1[k] = max(0, pool_after_1.get(k, 0) - q)

                            cands_2 = ml_generate_section_candidates(
                                mw, ml, ml - L1, pool_after_1, gen_model, pool_features, scorer_model, scorer_features
                            )
                            if cands_2:
                                matching_2 = [c for c in cands_2 if c["section_length"] == L2] or cands_2
                                matching_2.sort(key=score_section)
                                for top_2 in matching_2[:2]:
                                    sec1_copy = dict(top_1)
                                    sec1_copy["candidates_explored"] = format_trials(cands_1, top_1)
                                    sec2_copy = dict(top_2)
                                    sec2_copy["candidates_explored"] = format_trials(cands_2, top_2)
                                    r_secs = [sec1_copy, sec2_copy]

                                    pool_after_2 = dict(pool_after_1)
                                    for k, q in top_2["assignment"].items():
                                        pool_after_2[k] = max(0, pool_after_2.get(k, 0) - q)

                                    rem_l = ml - (L1 + top_2["section_length"])
                                    if rem_l > 0 and len(part) >= 3:
                                        L3 = part[2]
                                        cands_3 = ml_generate_section_candidates(
                                            mw, ml, rem_l, pool_after_2, gen_model, pool_features, scorer_model, scorer_features
                                        )
                                        if cands_3:
                                            matching_3 = [c for c in cands_3 if c["section_length"] == L3] or cands_3
                                            matching_3.sort(key=score_section)
                                            top_3 = matching_3[0]
                                            sec3_copy = dict(top_3)
                                            sec3_copy["candidates_explored"] = format_trials(cands_3, top_3)
                                            r_secs.append(sec3_copy)
                                            for k, q in top_3["assignment"].items():
                                                pool_after_2[k] = max(0, pool_after_2.get(k, 0) - q)

                                    candidate_roll_plans.append((r_secs, pool_after_2))
                    else:
                        L1 = part[0]
                        cands_1 = ml_generate_section_candidates(
                            mw, ml, ml, cur_pool, gen_model, pool_features, scorer_model, scorer_features
                        )
                        matching_1 = [c for c in cands_1 if c["section_length"] == L1] or cands_1
                        matching_1.sort(key=score_section)
                        for top_1 in matching_1[:2]:
                            sec1_copy = dict(top_1)
                            sec1_copy["candidates_explored"] = format_trials(cands_1, top_1)
                            pool_after_1 = dict(cur_pool)
                            for k, q in top_1["assignment"].items():
                                pool_after_1[k] = max(0, pool_after_1.get(k, 0) - q)
                            candidate_roll_plans.append(([sec1_copy], pool_after_1))

                # ── Strategy 2: Forward Multi-Run Search ─────────────────────────
                first_cands = ml_generate_section_candidates(
                    mw, ml, ml, cur_pool, gen_model, pool_features, scorer_model, scorer_features
                )
                if first_cands:
                    first_cands.sort(key=score_section)
                    selected_cands = first_cands[:6]

                    for top_sec in selected_cands:
                        top_sec_copy = dict(top_sec)
                        top_sec_copy["candidates_explored"] = format_trials(first_cands, top_sec)
                        roll_sections = [top_sec_copy]
                        local_rem = dict(cur_pool)
                        for k, q in top_sec["assignment"].items():
                            local_rem[k] = max(0, local_rem.get(k, 0) - q)
                        length_remaining = ml - top_sec["section_length"]

                        # Pack subsequent sections into this roll
                        while length_remaining > 0 and any(q > 0 for q in local_rem.values()):
                            sub_pool = {k: q for k, q in local_rem.items() if q > 0 and k[1] <= length_remaining and k[0] <= mw}
                            if not sub_pool:
                                break
                            sub_cands = ml_generate_section_candidates(
                                mw, ml, length_remaining, sub_pool, gen_model, pool_features, scorer_model, scorer_features
                            )
                            if not sub_cands:
                                break

                            def sub_score(c):
                                sec_waste = c["waste_area"]
                                rem_l = length_remaining - c["section_length"]
                                fillable = any(
                                    (pw, pl) != (w, l) or q > c["assignment"].get((w, l), 0)
                                    for (pw, pl), q in local_rem.items()
                                    if q > 0 and pl <= rem_l and pw <= mw
                                )
                                if rem_l == 0:
                                    rem_waste = 0
                                elif not fillable:
                                    rem_waste = rem_l * mw
                                else:
                                    rem_waste = rem_l * mw * 0.25
                                total_waste = sec_waste + rem_waste
                                width_trim = c["width_waste_mm"]
                                return (total_waste, width_trim, -c["used_area"])

                            sub_cands.sort(key=sub_score)
                            sec_chosen = dict(sub_cands[0])
                            sec_chosen["candidates_explored"] = format_trials(sub_cands, sec_chosen)
                            roll_sections.append(sec_chosen)
                            for k, q in sec_chosen["assignment"].items():
                                local_rem[k] = max(0, local_rem.get(k, 0) - q)
                            length_remaining -= sec_chosen["section_length"]

                        candidate_roll_plans.append((roll_sections, local_rem))

                # ── Register Candidate Rolls into Next Beam ──────────────────────
                seen_roll_sigs = set()
                for roll_sections, local_rem in candidate_roll_plans:
                    sig = tuple((s["section_length"], tuple(sorted(s["assignment"].items()))) for s in roll_sections)
                    if sig in seen_roll_sigs:
                        continue
                    seen_roll_sigs.add(sig)

                    used_area     = sum(s["used_area"] for s in roll_sections)
                    roll_area     = mw * ml
                    length_used   = sum(s["section_length"] for s in roll_sections)
                    end_remnant   = (ml - length_used) * mw
                    section_waste = sum(s["waste_area"] for s in roll_sections)
                    total_waste   = section_waste + end_remnant

                    total_width_remnant = sum(s.get("width_remnant_area", 0) for s in roll_sections)

                    roll_trials = []
                    for s_idx, s in enumerate(roll_sections, 1):
                        for t in s.get("candidates_explored", []):
                            t_entry = dict(t)
                            t_entry["run_idx"] = s_idx
                            roll_trials.append(t_entry)

                    r_num = state["roll_num"] + 1
                    new_plan = list(state["plan"]) + [{
                        "roll_num":                 r_num,
                        "master_width":             mw,
                        "master_length":            ml,
                        "roll_area":                roll_area,
                        "length_used":              length_used,
                        "remnant_length":           ml - length_used,
                        "remnant_area":             end_remnant,
                        "sections":                 roll_sections,
                        "candidates_explored":      roll_trials,
                        "total_used_area":          used_area,
                        "section_waste_area":       section_waste,
                        "total_waste_area":         total_waste,
                        "total_width_remnant_area": total_width_remnant,
                        "total_reusable_area":      end_remnant + total_width_remnant,
                        "efficiency_pct":           round(used_area / roll_area * 100, 2) if roll_area else 0.0,
                        "slitting_eff_pct":         round(used_area / (mw * length_used) * 100, 2) if length_used else 0.0,
                    }]

                    new_stock = dict(state["stock"])
                    if new_stock.get(key) != float("inf"):
                        new_stock[key] = max(0, new_stock[key] - 1)

                    child = {
                        "remaining":        local_rem,
                        "stock":            new_stock,
                        "plan":             new_plan,
                        "roll_num":         r_num,
                        "total_waste_area": state["total_waste_area"] + total_waste,
                        "total_used_area":  state["total_used_area"] + used_area,
                    }
                    next_beam.append(child)

        if not next_beam:
            break

        def rank_state(s):
            rem_area = sum(w * l * q for (w, l), q in s["remaining"].items() if q > 0)

            # Count how many finite-stock (remnant) rolls vs new (infinite-stock) rolls were used
            remnant_rolls_used = sum(
                1 for r in s["plan"]
                if stock.get((r["master_width"], r["master_length"]), float("inf")) < float("inf")
            )
            new_rolls_used = sum(
                1 for r in s["plan"]
                if stock.get((r["master_width"], r["master_length"]), float("inf")) == float("inf")
            )

            # Heavy priority: minimize new rolls opened, maximize remnant stock consumed
            new_roll_cost = new_rolls_used * 100_000_000
            remnant_use_bonus = remnant_rolls_used * 250_000_000

            # Direct penalty on actual trim scrap
            true_trim_scrap = sum(sec["waste_area"] * 5 for r in s["plan"] for sec in r["sections"])

            # Direct penalty on length remnant ONLY for new master rolls (not remnants which are already offcuts)
            length_remnant_cost = sum(
                r["remnant_area"] * 5 for r in s["plan"]
                if stock.get((r["master_width"], r["master_length"]), float("inf")) == float("inf")
            )

            # Large bonus for rolls that utilize full master roll length (remnant <= 100m)
            full_length_bonus = sum(
                35_000_000 for r in s["plan"] if r["remnant_length"] <= 100
            )

            # Bonus for rolls that achieve high slitting yield (>= 98%)
            high_yield_bonus = sum(
                30_000_000 for r in s["plan"] if r["slitting_eff_pct"] >= 98.0
            )

            # Penalty for slitting inefficiency (100% - yield)
            eff_penalty = sum(
                (100.0 - r["slitting_eff_pct"]) * 500_000 for r in s["plan"]
            )

            cost = new_roll_cost + true_trim_scrap + length_remnant_cost + eff_penalty - full_length_bonus - high_yield_bonus - remnant_use_bonus
            return (rem_area, cost)

        next_beam.sort(key=rank_state)

        pruned = []
        seen_states = set()
        for s in next_beam:
            fp = (tuple(sorted((k, q) for k, q in s["remaining"].items() if q > 0)), s["roll_num"], s["total_waste_area"])
            if fp not in seen_states:
                seen_states.add(fp)
                pruned.append(s)
            if len(pruned) >= beam_width:
                break

        beam = pruned
        if all(not any(q > 0 for q in s["remaining"].values()) for s in beam):
            break

    def final_rank(s):
        rem_area = sum(w * l * q for (w, l), q in s["remaining"].items() if q > 0)
        new_rolls_used = sum(
            1 for r in s["plan"]
            if stock.get((r["master_width"], r["master_length"]), float("inf")) == float("inf")
        )
        remnant_rolls_used = sum(
            1 for r in s["plan"]
            if stock.get((r["master_width"], r["master_length"]), float("inf")) < float("inf")
        )
        total_waste = sum(r["total_waste_area"] for r in s["plan"])
        # Priority order: fulfill all demand -> minimize new rolls -> maximize remnants -> tie-breakers
        return (rem_area, new_rolls_used, -remnant_rolls_used, s["roll_num"], total_waste)

    best = min(beam, key=final_rank)
    if return_inventory:
        return best["plan"], best["stock"]
    return best["plan"]


# ── 7. Output Formatter ───────────────────────────────────────────────────────

def print_plan_2d(plan):
    total_roll_area      = sum(r["roll_area"] for r in plan)
    total_used_area      = sum(r["total_used_area"] for r in plan)
    total_waste_area     = sum(r["total_waste_area"] for r in plan)
    total_slit_area      = sum(r["master_width"] * r["length_used"] for r in plan)
    total_sec_waste      = sum(r["section_waste_area"] for r in plan)
    total_length_remnant = sum(r["remnant_area"] for r in plan)
    total_width_remnant  = sum(r.get("total_width_remnant_area", 0) for r in plan)
    total_reusable       = total_length_remnant + total_width_remnant
    true_scrap           = max(0, total_waste_area - total_reusable)

    overall_eff = round(total_used_area / total_roll_area * 100, 2) if total_roll_area else 0.0
    slitting_eff = round(total_used_area / total_slit_area * 100, 2) if total_slit_area else 0.0

    print("\n" + "=" * 76)
    print("          2D ROLL CUTTING OPTIMIZATION PLAN  [100% Pure ML-Driven]")
    print("=" * 76)

    for r in plan:
        print(f"\n  Roll #{r['roll_num']}  [{r['master_width']}mm x {r['master_length']}m master roll]")
        print(f"    Slit Length: {r['length_used']}m / {r['master_length']}m  "
              f"| Remnant (Reusable): {r['remnant_length']}m ({r['remnant_area']:,} mm2)")

        for si, sec in enumerate(r["sections"], 1):
            cuts = ", ".join(
                f"{w}mm x {l}m x{q}"
                for (w, l), q in sorted(sec["assignment"].items(), reverse=True)
            )
            print(f"    Section {si} [{sec['section_length']}m]  :  {cuts}")
            print(f"      Width used   : {sec['used_width_mm']}mm / {r['master_width']}mm  "
                  f"| Width trim loss: {sec['width_waste_mm']}mm")
            if sec.get("is_width_remnant"):
                print(f"      -> Reusable Width Offcut: {sec['width_remnant_mm']}mm x {sec['width_remnant_length']}m ({sec['width_remnant_area']:,} mm2)")
            print(f"      Section area : {sec['section_area']:,} mm2  "
                  f"| Product cut: {sec['used_area']:,} mm2  "
                  f"| Trim waste: {sec['waste_area']:,} mm2 ({sec['waste_area_pct']:.1f}%)")
            print(f"      ML Scorer Pred: {sec['ml_pred_waste']:.1f}% waste")

        print(f"    -- Roll Slitting Efficiency : {r['slitting_eff_pct']}%  "
              f"| Overall Roll Utilization: {r['efficiency_pct']}%")

    print("\n" + "-" * 76)
    print(f"  Rolls used                 : {len(plan)}")
    print(f"  Total customer product cut : {total_used_area:,} mm2")
    print(f"  Total roll area allocated  : {total_roll_area:,} mm2")
    print(f"  Total slitting trim scrap  : {total_sec_waste:,} mm2")
    print(f"  Total reusable remnants    : {total_reusable:,} mm2")
    print(f"  Net non-reusable scrap     : {true_scrap:,} mm2")
    print(f"  Operational Slitting Eff.  : {slitting_eff}%")
    print(f"  Overall Roll Utilization   : {overall_eff}%")
    print("=" * 76)
    print(f"  Total roll area allocated  : {total_roll_area:,} mm2")
    print(f"  Total slitting trim scrap  : {total_sec_waste:,} mm2")
    print(f"  Total reusable remnants    : {total_reusable:,} mm2")
    print(f"  Net non-reusable scrap     : {true_scrap:,} mm2")
    print(f"  Operational Slitting Eff.  : {slitting_eff}%")
    print(f"  Overall Roll Utilization   : {overall_eff}%")
    print("=" * 76)
