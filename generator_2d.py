# -*- coding: utf-8 -*-
"""
generator_2d.py - 2D Cutting Stock Training Data Generator
===========================================================
Master roll: width (mm) x length (m)  — GSM is constant, ignored.
Customer order: width (mm) x length (m) x quantity.

Each training row = one "section decision" made during solving:
  Features = current pool state (widths, lengths, qtys remaining + master roll info)
  Targets  = how many of each customer slot to assign to this section
             (section_length is derived = max length of assigned customers)

Classic exhaustive search used ONLY here for ground-truth. NOT at inference.
"""

import random, itertools, csv
import numpy as np
from collections import Counter

random.seed(42)
np.random.seed(42)

# ── Config ────────────────────────────────────────────────────────────────────
MASTER_ROLL_WIDTHS   = [1000, 1200, 1400, 1500, 1800, 2000, 2300, 2500, 2800, 3000, 3200, 3600, 4000] # mm
MASTER_ROLL_LENGTHS  = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]                         # meters
ORDER_WIDTH_POOL     = [50, 80, 100, 120, 150, 180, 200, 220, 250, 300, 350, 400, 500, 550, 600, 700, 800, 900] # mm
ORDER_LENGTH_POOL    = [500, 800, 1000, 1500, 2000, 2500, 3000, 3500, 3800, 4000, 4200, 4500, 5000, 5500, 6000, 7000, 8000, 9000]   # meters
MAX_CUSTOMERS        = 15
NUM_SLOTS            = 10
MAX_QTY              = 30
NUM_SCENARIOS        = 6000
OUTPUT_PATH          = "cutting_stock_2d_dataset.csv"


# ── 1. Scenario generation ────────────────────────────────────────────────────

def new_scenario():
    """Random pool of unique (width, length) customer orders."""
    n = random.randint(2, MAX_CUSTOMERS)
    widths  = random.sample(ORDER_WIDTH_POOL, min(n, len(ORDER_WIDTH_POOL)))
    lengths = [random.choice(ORDER_LENGTH_POOL) for _ in range(len(widths))]
    return {(w, l): random.randint(1, MAX_QTY) for w, l in zip(widths, lengths)}


# ── 2. Length-compatible grouping ─────────────────────────────────────────────

def group_by_length(pool):
    """
    Groups orders by primary length with cross-length compatibility.
    Any available customer item that fits within the primary run length is eligible.
    """
    items  = sorted(pool.items(), key=lambda x: x[0][1], reverse=True)
    used   = [False] * len(items)
    groups = []

    for i, (ki, qi) in enumerate(items):
        if used[i]:
            continue
        group = {ki: qi}
        used[i] = True
        ref_len = ki[1]
        for j, (kj, qj) in enumerate(items):
            if used[j]:
                continue
            # Allow all items that can be slit within ref_len (multi-length slitting)
            if kj[1] <= ref_len:
                group[kj] = qj
                used[j] = True
        groups.append(group)
    return groups


# ── 3. Optimal width combo (ground-truth DP knapsack) ─────────────────────────

def best_width_combo(width_pool, master_width):
    """
    Exact Bounded Knapsack DP to find subset of widths maximizing used_width <= master_width.
    Guaranteed optimal, O(N * W), runs in milliseconds without combinatorial explosions.
    """
    dp = {0: {}}
    for w, q in sorted(width_pool.items(), reverse=True):
        if w > master_width or q <= 0:
            continue
        max_take = min(q, master_width // w)
        for cur_w, combo in list(dp.items()):
            for k in range(1, max_take + 1):
                nxt_w = cur_w + k * w
                if nxt_w <= master_width:
                    if nxt_w not in dp or sum(dp[nxt_w].values()) < sum(combo.values()) + k:
                        nxt_combo = dict(combo)
                        nxt_combo[w] = nxt_combo.get(w, 0) + k
                        dp[nxt_w] = nxt_combo

    best_w = max(dp.keys(), default=0)
    best_combo = dp.get(best_w, {})
    return best_combo, master_width - best_w


# ── 4. Feature-row builder ────────────────────────────────────────────────────

def pool_slots(pool, scenario_keys):
    """
    Map pool to fixed NUM_SLOTS slots, sorted by area_left desc.
    Returns list of (width, length, qty) tuples, length = NUM_SLOTS.
    """
    areas = {k: k[0] * k[1] * pool.get(k, 0) for k in scenario_keys}
    sorted_keys = sorted(scenario_keys, key=lambda k: areas.get(k, 0), reverse=True)
    slots = []
    for i in range(NUM_SLOTS):
        if i < len(sorted_keys):
            k   = sorted_keys[i]
            w, l = k
            q   = pool.get(k, 0)
        else:
            w, l, q = 0, 0, 0
        slots.append((w, l, q))
    return slots


def build_row(sid, sec_num, master_width, master_length, length_remaining,
              pool, scenario_keys, assignment, section_length):
    slots  = pool_slots(pool, scenario_keys)
    active = [(w, l, q) for (w, l), q in pool.items() if q > 0]

    widths_rem  = [w for w, l, q in active]
    lengths_rem = [l for w, l, q in active]
    total_area  = sum(w * l * q for w, l, q in active)
    avg_w  = float(np.mean(widths_rem))  if widths_rem  else 0.0
    avg_l  = float(np.mean(lengths_rem)) if lengths_rem else 0.0
    std_w  = float(np.std(widths_rem))   if len(widths_rem)  > 1 else 0.0
    std_l  = float(np.std(lengths_rem))  if len(lengths_rem) > 1 else 0.0

    row = {
        "scenario_id":            sid,
        "section_num":            sec_num,
        "master_roll_width":      master_width,
        "master_roll_length":     master_length,
        "master_length_remaining": length_remaining,
    }

    for i, (w, l, q) in enumerate(slots, 1):
        row[f"pool_cust{i}_width"]    = w
        row[f"pool_cust{i}_length"]   = l
        row[f"pool_cust{i}_qty"]      = q
        row[f"pool_cust{i}_area_left"] = w * l * q

    row.update({
        "pool_total_remaining_area": total_area,
        "pool_n_active":             sum(1 for _, _, q in active if q > 0),
        "pool_avg_width":            round(avg_w, 2),
        "pool_std_width":            round(std_w, 2),
        "pool_avg_length":           round(avg_l, 2),
        "pool_std_length":           round(std_l, 2),
        "pool_area_utilization":     round(total_area / (master_width * length_remaining), 4)
                                     if length_remaining > 0 else 0.0,
    })

    # Targets: qty per slot
    slot_keys = [(w, l) for w, l, q in slots]
    for i, k in enumerate(slot_keys, 1):
        row[f"assign_cust{i}_qty"] = assignment.get(k, 0) if k[0] else 0

    # Result metrics — accurately compute true customer product cut (width * length * qty)
    used_width   = sum(w * assignment.get((w, l), 0) for w, l, q in active)
    section_area = master_width * section_length
    used_area    = sum(w * l * q for (w, l), q in assignment.items())
    waste_area   = max(0, section_area - used_area)

    row.update({
        "section_length":  section_length,
        "used_width_mm":   used_width,
        "waste_area_pct": round(waste_area / section_area * 100, 4) if section_area > 0 else 100.0,
    })
    return row


# ── 5. Dataset builder ────────────────────────────────────────────────────────

def build_dataset():
    rows = []

    for sid in range(NUM_SCENARIOS):
        orders         = new_scenario()
        scenario_keys  = list(orders.keys())
        master_width   = random.choice(MASTER_ROLL_WIDTHS)
        master_length  = random.choice(MASTER_ROLL_LENGTHS)

        remaining        = dict(orders)
        length_remaining = master_length
        sec_num          = 0

        while any(q > 0 for q in remaining.values()) and length_remaining > 0 and sec_num < 25:
            pool = {k: q for k, q in remaining.items() if q > 0}
            if not pool:
                break

            # Group by compatible lengths, take the first (longest-length) group
            groups = group_by_length(pool)
            if not groups:
                break

            group = groups[0]

            # Section length = max customer length in group (capped by remaining roll)
            section_length = min(max(l for (w, l) in group.keys()), length_remaining)

            # Only keep orders whose length fits this section
            group = {(w, l): q for (w, l), q in group.items() if l <= section_length}
            if not group:
                # Skip ahead: remove longest order from remaining (can't fit)
                longest_key = max(pool.keys(), key=lambda k: k[1])
                remaining.pop(longest_key, None)
                continue

            # Build width pool (merge same-width orders across different lengths)
            width_pool = {}
            for (w, l), q in group.items():
                width_pool[w] = width_pool.get(w, 0) + q

            # Find best width combo for this section
            width_combo, width_waste = best_width_combo(width_pool, master_width)
            if not width_combo:
                break

            # Map width combo → (width, length) assignment
            assignment   = {}
            combo_remain = dict(width_combo)
            for (w, l), q in sorted(group.items(), key=lambda x: x[0][1], reverse=True):
                take = min(q, combo_remain.get(w, 0))
                if take > 0:
                    assignment[(w, l)] = take
                    combo_remain[w] = combo_remain.get(w, 0) - take

            if not assignment:
                break

            rows.append(build_row(
                sid, sec_num, master_width, master_length, length_remaining,
                pool, scenario_keys, assignment, section_length
            ))

            # Update state
            for k, q in assignment.items():
                remaining[k] = max(0, remaining.get(k, 0) - q)
            length_remaining -= section_length
            sec_num += 1

        if sid % 200 == 0:
            print(f"  Scenario {sid:>4}/{NUM_SCENARIOS}   rows so far: {len(rows)}")

    return rows


# ── 6. Save ───────────────────────────────────────────────────────────────────

FIELDNAMES = (
    ["scenario_id", "section_num", "master_roll_width", "master_roll_length", "master_length_remaining"]
    + [f for i in range(1, NUM_SLOTS + 1)
       for f in (f"pool_cust{i}_width", f"pool_cust{i}_length",
                 f"pool_cust{i}_qty",   f"pool_cust{i}_area_left")]
    + ["pool_total_remaining_area", "pool_n_active",
       "pool_avg_width", "pool_std_width", "pool_avg_length", "pool_std_length",
       "pool_area_utilization"]
    + [f"assign_cust{i}_qty" for i in range(1, NUM_SLOTS + 1)]
    + ["section_length", "used_width_mm", "waste_area_pct"]
    # Dropped: width_waste_mm, section_area, used_area, waste_area (derivable)
)


if __name__ == "__main__":
    print("Generating 2D cutting stock training dataset...")
    print(f"  Scenarios        : {NUM_SCENARIOS}")
    print(f"  Master widths    : {MASTER_ROLL_WIDTHS}")
    print(f"  Master lengths   : {MASTER_ROLL_LENGTHS}")
    print("  Length tolerance : Cross-length compatibility enabled")
    print()

    rows = build_dataset()

    with open(OUTPUT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(rows)

    wastes = [r["waste_area_pct"] for r in rows]
    zero   = sum(1 for v in wastes if v <= 0.01)
    print()
    print("=" * 50)
    print(f"  Total rows       : {len(rows)}")
    print(f"  Zero-waste rows  : {zero} ({round(zero/len(rows)*100,1)}%)")
    print(f"  Avg area waste   : {round(sum(wastes)/len(wastes), 2)}%")
    print(f"  Waste range      : {min(wastes):.2f}% - {max(wastes):.2f}%")
    print(f"  Saved to         : {OUTPUT_PATH}")
    print("=" * 50)
    print()
    print("Next: run  python train_2d.py")
