# -*- coding: utf-8 -*-
"""
generator_v2.py - Training Data for ML-Driven Combo Generation (FIXED)
======================================================================
CRITICAL FIX: Replaced itertools.combinations (which gives up early on
large pools) with Cartesian product quantity enumeration. This GUARANTEES
optimal solutions for every single training row.

Old approach: itertools.combinations on individual units → O(C(n,r)) → 
  gives up at 80,000 combos → produces garbage labels for 38% of data

New approach: itertools.product on quantity ranges → O(prod(q_i+1)) →
  max 6^5 = 7,776 combos → ALWAYS finds the optimal solution

Each row = one roll assignment in a full scenario sequence.
Features  = pool state (what widths remain + how many)
Targets   = optimal assignment (which widths + qty to put on this roll)
"""

import random, itertools, csv, time
from collections import Counter

random.seed(42)

ROLL_WIDTHS       = [2500, 2800, 3000, 3200, 3600, 4200]
ORDER_WIDTH_POOL  = [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900]
MAX_CUSTOMERS     = 5
MAX_QTY           = 8       # Increased from 5 → more diverse patterns
NUM_SCENARIOS     = 10000   # Increased from 1000 → 10x more data
OUTPUT_PATH       = "cutting_stock_dataset_v2.csv"


# -----------------------------------------------------------
# 1. SCENARIO GENERATION
# -----------------------------------------------------------

def new_scenario():
    """Generate a random customer order scenario."""
    n = random.randint(2, MAX_CUSTOMERS)
    widths = random.sample(ORDER_WIDTH_POOL, n)
    return {w: random.randint(1, MAX_QTY) for w in widths}


# -----------------------------------------------------------
# 2. OPTIMAL COMBO FINDER (FIXED - guaranteed optimal)
# -----------------------------------------------------------

def find_best_combo(pool, roll_width):
    """
    Find the OPTIMAL (minimum waste) assignment for a single roll.
    Uses Cartesian product over quantity ranges instead of combinations.
    
    For 5 widths with max_qty=8, worst case is 9^5 = 59,049 combos.
    For 5 widths with max_qty=5, worst case is 6^5 = 7,776 combos.
    ALWAYS finds the true optimum. No early termination.
    
    Used ONLY during training data generation -- never at inference.
    """
    items = []
    for w, q in pool.items():
        if w > 0 and q > 0 and w <= roll_width:
            max_fit = min(q, roll_width // w)
            items.append((w, max_fit))
    
    if not items:
        return {}, roll_width
    
    best_assignment = {}
    best_waste = roll_width + 1
    
    # Enumerate ALL valid quantity combinations
    qty_ranges = [range(0, max_q + 1) for _, max_q in items]
    
    for qtys in itertools.product(*qty_ranges):
        used = sum(items[i][0] * qtys[i] for i in range(len(items)))
        if used <= roll_width:
            waste = roll_width - used
            if waste < best_waste:
                best_waste = waste
                best_assignment = {
                    items[i][0]: qtys[i]
                    for i in range(len(items))
                    if qtys[i] > 0
                }
                if waste == 0:
                    return best_assignment, 0
    
    return best_assignment, best_waste


# -----------------------------------------------------------
# 3. FEATURE ROW BUILDER
# -----------------------------------------------------------

def pool_slots(pool, scenario_widths):
    """Fixed 5-slot representation, sorted by width desc (consistent ordering)."""
    sw = sorted(scenario_widths, reverse=True)
    return [(sw[i], pool.get(sw[i], 0)) if i < len(sw) else (0, 0) for i in range(5)]


def build_row(sid, roll_num, roll_width, pool, scenario_widths, assignment, waste_mm):
    slots = pool_slots(pool, scenario_widths)
    active = [(w, q) for w, q in pool.items() if q > 0]
    total_rem   = sum(w * q for w, q in active)
    widths_rem  = [w for w, _ in active]
    avg_w       = sum(widths_rem) / len(widths_rem) if widths_rem else 0

    row = {"scenario_id": sid, "roll_num": roll_num, "roll_width": roll_width}

    for i, (w, q) in enumerate(slots, 1):
        row[f"pool_cust{i}_width"]     = w
        row[f"pool_cust{i}_remaining"] = q
        row[f"pool_cust{i}_mm_left"]   = w * q

    row.update({
        "pool_total_remaining_mm": total_rem,
        "pool_n_widths":           sum(1 for _, q in active if q > 0),
        "pool_utilization":        round(total_rem / roll_width, 6) if roll_width else 0,
        "pool_max_width":          max(widths_rem) if widths_rem else 0,
        "pool_min_width":          min(widths_rem) if widths_rem else 0,
        "pool_avg_width":          round(avg_w, 4),
        "pool_std_width":          round(
            (sum((w - avg_w)**2 for w in widths_rem) / len(widths_rem)) ** 0.5
            if len(widths_rem) > 1 else 0, 4),
    })

    for i, (w, _) in enumerate(slots, 1):
        row[f"assign_cust{i}_qty"] = assignment.get(w, 0) if w else 0

    row.update({
        "resulting_used_mm":  roll_width - waste_mm,
        "resulting_waste_mm": waste_mm,
        "resulting_waste_pct": round(waste_mm / roll_width * 100, 4),
    })
    return row


# -----------------------------------------------------------
# 4. DATASET BUILDER
# -----------------------------------------------------------

def build_dataset():
    rows = []

    for sid in range(NUM_SCENARIOS):
        orders = new_scenario()
        scenario_widths = list(orders.keys())
        # Use different roll widths for each scenario roll for diversity
        remaining = dict(orders)
        roll_num = 0

        while any(q > 0 for q in remaining.values()) and roll_num < 15:
            pool = {w: q for w, q in remaining.items() if q > 0}
            roll_width = random.choice(ROLL_WIDTHS)
            assignment, waste = find_best_combo(pool, roll_width)
            if not assignment:
                break

            rows.append(build_row(sid, roll_num, roll_width, pool,
                                  scenario_widths, assignment, waste))

            for w, q in assignment.items():
                remaining[w] = max(0, remaining.get(w, 0) - q)
            roll_num += 1

        if sid % 500 == 0:
            print(f"  Scenario {sid}/{NUM_SCENARIOS}  rows so far: {len(rows)}")

    return rows


# -----------------------------------------------------------
# 5. SAVE
# -----------------------------------------------------------

FIELDNAMES = [
    "scenario_id", "roll_num", "roll_width",
    "pool_cust1_width", "pool_cust1_remaining", "pool_cust1_mm_left",
    "pool_cust2_width", "pool_cust2_remaining", "pool_cust2_mm_left",
    "pool_cust3_width", "pool_cust3_remaining", "pool_cust3_mm_left",
    "pool_cust4_width", "pool_cust4_remaining", "pool_cust4_mm_left",
    "pool_cust5_width", "pool_cust5_remaining", "pool_cust5_mm_left",
    "pool_total_remaining_mm", "pool_n_widths", "pool_utilization",
    "pool_max_width", "pool_min_width", "pool_avg_width", "pool_std_width",
    "assign_cust1_qty", "assign_cust2_qty", "assign_cust3_qty",
    "assign_cust4_qty", "assign_cust5_qty",
    "resulting_used_mm", "resulting_waste_mm", "resulting_waste_pct",
]

def save_csv(rows, path):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    t0 = time.time()
    print("Generating v2 ML training dataset (FIXED - guaranteed optimal labels)...")
    print(f"  Scenarios  : {NUM_SCENARIOS}")
    print(f"  Roll widths: {ROLL_WIDTHS}")
    print(f"  Max qty    : {MAX_QTY}")
    print(f"  Method     : Cartesian product quantity enumeration (exact)")
    print()

    rows = build_dataset()
    save_csv(rows, OUTPUT_PATH)

    wastes = [r["resulting_waste_pct"] for r in rows]
    zero_waste = sum(1 for w in wastes if w == 0)
    low_waste = sum(1 for w in wastes if 0 < w <= 5)
    high_waste = sum(1 for w in wastes if w > 20)
    
    elapsed = time.time() - t0
    print()
    print("=" * 55)
    print(f"  Total rows        : {len(rows)}")
    print(f"  Zero-waste rows   : {zero_waste} ({round(zero_waste/len(rows)*100, 1)}%)")
    print(f"  Low-waste (0-5%)  : {low_waste} ({round(low_waste/len(rows)*100, 1)}%)")
    print(f"  High-waste (>20%) : {high_waste} ({round(high_waste/len(rows)*100, 1)}%)")
    print(f"  Avg waste         : {round(sum(wastes)/len(wastes), 2)}%")
    print(f"  Waste range       : {min(wastes):.2f}% - {max(wastes):.2f}%")
    print(f"  Time elapsed      : {elapsed:.1f}s")
    print(f"  Saved to          : {OUTPUT_PATH}")
    print("=" * 55)
    print()
    print("Next: run train_model_v2.py")
