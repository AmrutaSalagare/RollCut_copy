# -*- coding: utf-8 -*-
"""
main_2d.py — Interactive CLI for 2D Roll Cutting Optimizer
===========================================================
Usage: python main_2d.py
"""

from solver_2d import load_models, solve_2d, print_plan_2d


def parse_int(prompt, min_val=1):
    while True:
        try:
            v = int(input(prompt).strip())
            if v >= min_val:
                return v
            print(f"  Please enter a value >= {min_val}.")
        except ValueError:
            print("  Invalid input. Please enter an integer.")


def get_master_rolls():
    print("\n-- Master Roll Catalog ----------------------------------")
    print("  Enter each master roll as:  width_mm  length_m  [optional_qty]")
    print("  (e.g., '3000 5000' or '2500 3000 2'). Type 'done' when finished.")
    print("  Press Enter immediately to use default catalog [(3000, 5000), (2500, 3000)].\n")

    rolls = []
    inventory = {}

    try:
        first_line = input("  Master roll (width length [qty]): ").strip()
    except EOFError:
        first_line = ""

    if not first_line:
        rolls = [(3000, 5000), (2500, 3000)]
        print("  [OK] Using default catalog: 3000mm x 5000m, 2500mm x 3000m")
        return rolls, None

    lines = [first_line]
    while True:
        try:
            raw = input("  Master roll (width length [qty]): ").strip() if not lines else lines.pop(0)
        except EOFError:
            break
        if raw.lower() == "done":
            if not rolls:
                print("  At least one master roll is required.")
                continue
            break
        parts = raw.split()
        if len(parts) not in (2, 3):
            print("  Enter two or three numbers: width_mm, length_m, [qty].")
            continue
        try:
            w, l = int(parts[0]), int(parts[1])
            q = int(parts[2]) if len(parts) == 3 else None
            if w <= 0 or l <= 0:
                print("  Both width and length must be positive.")
                continue
            if q is not None and q <= 0:
                print("  Quantity must be positive.")
                continue
            rolls.append((w, l))
            if q is not None:
                inventory[(w, l)] = q
            q_str = f" x{q}" if q is not None else " (unlimited)"
            print(f"  [OK] Added {w}mm x {l}m{q_str}")
        except ValueError:
            print("  Invalid numbers.")

    return rolls, (inventory if inventory else None)


def get_orders():
    print("\n-- Customer Orders --------------------------------------")
    print("  Enter each order as:  width_mm  length_m  qty  (e.g. 500 2000 3)")
    print("  Press Enter immediately to use default test order set.\n")

    try:
        first_line = input("  Order (width length qty): ").strip()
    except EOFError:
        first_line = ""

    if not first_line:
        orders = [
            (500, 2000, 3),
            (700, 2000, 2),
            (300, 4000, 4),
            (600, 1000, 2),
        ]
        print("  [OK] Using default orders:")
        for w, l, q in orders:
            print(f"    {w}mm x {l}m  x{q}")
        return orders

    orders = []
    lines = [first_line]
    while True:
        try:
            raw = input("  Order (width length qty): ").strip() if not lines else lines.pop(0)
        except EOFError:
            break
        if raw.lower() == "done":
            if not orders:
                print("  At least one order is required.")
                continue
            break
        parts = raw.split()
        if len(parts) != 3:
            print("  Enter exactly three numbers: width_mm, length_m, and qty.")
            continue
        try:
            w, l, q = int(parts[0]), int(parts[1]), int(parts[2])
            if w <= 0 or l <= 0 or q <= 0:
                print("  All values must be positive.")
                continue
            orders.append((w, l, q))
            print(f"  [OK] Added {w}mm x {l}m x {q}")
        except ValueError:
            print("  Invalid numbers.")

    return orders


def main():
    print("=" * 66)
    print("     2D ROLL CUTTING OPTIMIZER  [Dual-ML Model System]")
    print("=" * 66)

    print("\nLoading ML models...", end=" ", flush=True)
    gen_model, scorer_model, pool_feats, _, scorer_feats = load_models()
    print("ready.")

    rolls, inventory = get_master_rolls()
    orders = get_orders()

    max_w = max(w for w, l in rolls)
    max_l = max(l for w, l in rolls)

    oversized = [(w, l, q) for w, l, q in orders if w > max_w or l > max_l]
    if oversized:
        print(f"\n  [WARN] Some orders exceed maximum roll bounds ({max_w}mm x {max_l}m):")
        for w, l, q in oversized:
            print(f"    {w}mm x {l}m x {q}  <- cannot fit on any catalog roll, skipped")
        orders = [(w, l, q) for w, l, q in orders if w <= max_w and l <= max_l]

    if not orders:
        print("\n  No valid orders remaining to cut. Please check input dimensions.")
        return

    print("\nOptimizing slitting schedule...", flush=True)
    plan = solve_2d(
        rolls, orders, gen_model, pool_feats,
        scorer_model=scorer_model, scorer_features=scorer_feats,
        roll_inventory=inventory, beam_width=8
    )

    if not plan:
        print("\n  No cutting plan could be generated. Please check your inputs.")
    else:
        print_plan_2d(plan)


if __name__ == "__main__":
    main()
