# -*- coding: utf-8 -*-
"""
app.py - Enterprise API and Web Server for 1D Roll Cutting Optimization
"""

import os
import sys
import logging
import time
import flask.cli
from flask import Flask, request, jsonify, send_from_directory

# Suppress Flask server banner and request logging
flask.cli.show_server_banner = lambda *args: None
logging.getLogger("werkzeug").setLevel(logging.ERROR)

app = Flask(__name__, static_folder="static")

# Load 1D ML models (optional: without solver_v2 / its model the 1D API reports an
# error, and the 2D side still runs)
try:
    from solver_v2 import load_models, solve
    gen_model, _, pool_feats, _, _ = load_models()
except Exception as e:
    gen_model, pool_feats = None, None

# Load 2D ML models
try:
    import solver_2d
    from solver_2d import load_models as load_models_2d, solve_2d
    gen_model_2d, scorer_model_2d, pool_feats_2d, _, scorer_feats_2d = load_models_2d()
except Exception as e:
    gen_model_2d, scorer_model_2d, pool_feats_2d, scorer_feats_2d = None, None, None, None


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "model_1d_loaded": gen_model is not None,
        "model_2d_loaded": gen_model_2d is not None,
        "version": "2.1.0"
    })


@app.route("/api/optimize", methods=["POST"])
def optimize():
    if gen_model is None:
        return jsonify({"error": "ML model is not loaded. Please verify model files."}), 500

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Invalid request payload. Expected JSON."}), 400

    roll_widths_raw = data.get("roll_widths", [])
    orders_raw = data.get("orders", [])
    roll_inv_raw = data.get("roll_inventory", {})

    # Validate and parse master roll widths with optional quantities
    roll_inventory = {}
    roll_widths = []
    try:
        for item in roll_widths_raw:
            if isinstance(item, dict):
                w = int(item.get("width", 0))
                q = item.get("qty")
                q = int(q) if q is not None and str(q).strip() != "" and int(q) >= 0 else None
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                w = int(item[0])
                q = int(item[1]) if item[1] is not None and int(item[1]) >= 0 else None
            else:
                w = int(item)
                q = None
            if w > 0:
                if w not in roll_widths:
                    roll_widths.append(w)
                if q is not None:
                    if w in roll_inventory and roll_inventory[w] is not None:
                        roll_inventory[w] += q
                    elif w not in roll_inventory:
                        roll_inventory[w] = q
                else:
                    roll_inventory[w] = None

        # Also merge any roll_inventory passed directly
        if isinstance(roll_inv_raw, dict):
            for k, v in roll_inv_raw.items():
                w = int(k)
                q = int(v) if v is not None and str(v).strip() != "" and int(v) >= 0 else None
                if w > 0:
                    if w not in roll_widths:
                        roll_widths.append(w)
                    if q is not None:
                        if w in roll_inventory and roll_inventory[w] is not None:
                            roll_inventory[w] += q
                        elif w not in roll_inventory:
                            roll_inventory[w] = q
                    else:
                        roll_inventory[w] = None
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid roll widths. Must be positive integers."}), 400

    if not roll_widths:
        return jsonify({"error": "At least one valid master roll width is required."}), 400

    # Validate and aggregate customer orders by cut width
    order_dict = {}
    try:
        for item in orders_raw:
            if isinstance(item, (list, tuple)) and len(item) == 2:
                w, q = int(item[0]), int(item[1])
            elif isinstance(item, dict):
                w, q = int(item.get("width", 0)), int(item.get("quantity", 0))
            else:
                continue
            if w > 0 and q > 0:
                order_dict[w] = order_dict.get(w, 0) + q
    except (ValueError, TypeError):
        return jsonify({"error": "Orders must specify positive integer width and quantity."}), 400

    orders = list(order_dict.items())
    if not orders:
        return jsonify({"error": "At least one valid customer order is required."}), 400

    # Check for unfulfillable items
    max_roll = max(roll_widths)
    oversized = [w for w, q in orders if w > max_roll]
    if oversized:
        return jsonify({
            "error": f"Ordered width ({oversized[0]}mm) exceeds maximum available roll size ({max_roll}mm)."
        }), 400

    try:
        beam_width = int(data.get("beam_width", 3)) if data.get("beam_width") else 3
        plan, remaining_stock, unfulfilled = solve(
            roll_widths, orders, gen_model, pool_feats,
            roll_inventory=roll_inventory, return_inventory=True,
            beam_width=beam_width
        )
        
        total_used = sum(r["used_mm"] for r in plan)
        total_waste = sum(r["waste_mm"] for r in plan)
        total_capacity = sum(r["roll_width"] for r in plan)
        efficiency_pct = round((total_used / total_capacity * 100), 2) if total_capacity else 0
        total_demand = sum(w * q for w, q in orders)

        # Format roll details with proportional cut segments for frontend visualization
        formatted_plan = []
        for r in plan:
            cuts_list = []
            for w, q in sorted(r["cuts"].items(), reverse=True):
                for idx in range(q):
                    cuts_list.append({
                        "width": w,
                        "pct_of_roll": round((w / r["roll_width"]) * 100, 3)
                    })

            formatted_plan.append({
                "roll_num": r["roll_num"],
                "roll_width": r["roll_width"],
                "used_mm": r["used_mm"],
                "waste_mm": r["waste_mm"],
                "waste_pct": r["waste_pct"],
                "efficiency_pct": r["efficiency_pct"],
                "cuts_summary": [{"width": w, "quantity": q} for w, q in sorted(r["cuts"].items(), reverse=True)],
                "segments": cuts_list,
                "waste_pct_of_roll": round((r["waste_mm"] / r["roll_width"]) * 100, 3),
                "candidates_explored": r.get("candidates_explored", [])
            })

        response_data = {
            "summary": {
                "rolls_used": len(plan),
                "total_demand_mm": total_demand,
                "total_capacity_mm": total_capacity,
                "total_used_mm": total_used,
                "total_waste_mm": total_waste,
                "efficiency_pct": efficiency_pct
            },
            "plan": formatted_plan,
            "remaining_inventory": remaining_stock,
            "unfulfilled_orders": [{"width": w, "quantity": q} for w, q in unfulfilled.items()]
        }
        return jsonify(response_data)

    except Exception as ex:
        return jsonify({"error": f"Optimization execution error: {str(ex)}"}), 500


@app.route("/api/optimize-2d", methods=["POST"])
def optimize_2d():
    if gen_model_2d is None:
        return jsonify({"error": "2D ML model is not loaded. Please verify 2D model files."}), 500

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Invalid request payload. Expected JSON."}), 400

    raw_rolls  = data.get("master_rolls", [])
    raw_orders = data.get("orders", [])
    beam_w     = int(data.get("beam_width", 16))

    # Parse rolls: list of (width, length) or dicts {"width": w, "length": l, "qty": q}
    master_rolls = []
    inventory    = {}
    unlimited_sizes = set()
    try:
        for r in raw_rolls:
            if isinstance(r, dict):
                w, l = int(r.get("width", 0)), int(r.get("length", 0))
                q = int(r["qty"]) if "qty" in r and r["qty"] is not None and str(r["qty"]).strip() != "" else (1 if r.get("isRemnant") else None)
            elif isinstance(r, (list, tuple)) and len(r) >= 2:
                w, l = int(r[0]), int(r[1])
                q = int(r[2]) if len(r) >= 3 and r[2] is not None else None
            else:
                continue
            if w > 0 and l > 0:
                master_rolls.append((w, l))
                key = (w, l)
                if q is not None and q > 0:
                    inventory[key] = (inventory[key] + q) if key in inventory else q
                elif q is None:
                    unlimited_sizes.add(key)
        for k in unlimited_sizes:
            inventory.pop(k, None)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid master roll specifications."}), 400

    if not master_rolls:
        return jsonify({"error": "At least one valid master roll (width, length) is required."}), 400

    # Parse orders: list of (width, length, qty) or dicts {"width": w, "length": l, "quantity": q}
    orders_dict = {}
    try:
        for o in raw_orders:
            if isinstance(o, dict):
                w = int(o.get("width", 0))
                l = int(o.get("length", 0))
                q = int(o.get("quantity", o.get("qty", 0)))
            elif isinstance(o, (list, tuple)) and len(o) >= 3:
                w, l, q = int(o[0]), int(o[1]), int(o[2])
            else:
                continue
            if w > 0 and l > 0 and q > 0:
                key = (w, l)
                orders_dict[key] = orders_dict.get(key, 0) + q
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid customer orders format."}), 400

    orders = [(w, l, q) for (w, l), q in orders_dict.items()]
    if not orders:
        return jsonify({"error": "At least one valid customer order is required."}), 400

    # Delivery urgency per piece size: [{"width", "length", "weights": [most urgent first]}]
    priority = {}
    try:
        for p in data.get("priority", []) or []:
            ws = sorted((float(x) for x in p.get("weights", []) if float(x) > 0), reverse=True)
            if ws:
                priority[(int(p["width"]), int(p["length"]))] = ws
    except (ValueError, TypeError, KeyError):
        priority = {}

    try:
        # The module is imported once (not reloaded) so its section-candidate cache
        # carries over between requests, e.g. the delivery-priority re-plan.
        plan, remaining_stock = solver_2d.solve_2d(
            master_rolls, orders, gen_model_2d, pool_feats_2d,
            scorer_model=scorer_model_2d, scorer_features=scorer_feats_2d,
            roll_inventory=inventory if inventory else None,
            beam_width=beam_w,
            return_inventory=True,
            priority=priority or None
        )

        formatted_plan = []
        for r in plan:
            formatted_secs = []
            for s in r["sections"]:
                # quantity = customer pieces; stack = pieces wound end-to-end in one lane
                # (lanes drawn = quantity / stack)
                cuts_list = []
                stacked = {}
                for st in s.get("stacks", []):
                    stacked.setdefault((st["width"], st["length"]), []).append(st)
                for (w, l), q in sorted(s["assignment"].items(), reverse=True):
                    for st in stacked.get((w, l), []):
                        n = min(q, st["lanes"] * st["stack"])
                        if n > 0:
                            cuts_list.append({"width": w, "length": l, "quantity": n, "stack": st["stack"]})
                            q -= n
                    if q > 0:
                        cuts_list.append({"width": w, "length": l, "quantity": q})
                formatted_secs.append({
                    "section_length":        s["section_length"],
                    "used_width_mm":         s["used_width_mm"],
                    "width_waste_mm":        s["width_waste_mm"],
                    "used_area":             s["used_area"],
                    "section_area":          s["section_area"],
                    "waste_area":            s["waste_area"],
                    "waste_area_pct":        s["waste_area_pct"],
                    "ml_pred_waste":         s.get("ml_pred_waste", 0.0),
                    "is_width_remnant":      s.get("is_width_remnant", s["width_waste_mm"] >= 150),
                    "width_remnant_mm":      s.get("width_remnant_mm", s["width_waste_mm"] if s["width_waste_mm"] >= 150 else 0),
                    "width_remnant_length":  s.get("width_remnant_length", s["section_length"] if s["width_waste_mm"] >= 150 else 0),
                    "width_remnant_area":    s.get("width_remnant_area", (s["width_waste_mm"] * s["section_length"]) if s["width_waste_mm"] >= 150 else 0),
                    "candidates_explored":   s.get("candidates_explored", []),
                    "cuts":                  cuts_list,
                })
            formatted_plan.append({
                "roll_num":                    r["roll_num"],
                "master_width":                r["master_width"],
                "master_length":               r["master_length"],
                "roll_area":                   r["roll_area"],
                "length_used":                 r["length_used"],
                "remnant_length":              r["remnant_length"],
                "remnant_area":                r["remnant_area"],
                "total_width_remnant_area":    r.get("total_width_remnant_area", 0),
                "total_reusable_area":         r.get("total_reusable_area", r["remnant_area"]),
                "sections":                    formatted_secs,
                "candidates_explored":          r.get("candidates_explored", []),
                "total_used_area":             r["total_used_area"],
                "section_waste_area":          r["section_waste_area"],
                "total_waste_area":            r["total_waste_area"],
                "slitting_eff_pct":            r["slitting_eff_pct"],
                "overall_roll_utilization_pct": r["efficiency_pct"],
            })

        total_product_cut = sum(r["total_used_area"] for r in plan)

        # Track parent vs child rolls to prevent double-counting of remnants
        remnants_produced = []
        raw_allocated_area = 0
        raw_rolls_count = 0

        for r in plan:
            mw, ml = r["master_width"], r["master_length"]
            consumed = False
            for rem in remnants_produced:
                if not rem["consumed"] and rem["width"] == mw and rem["length"] == ml:
                    rem["consumed"] = True
                    consumed = True
                    break

            if not consumed:
                raw_allocated_area += r["roll_area"]
                raw_rolls_count += 1

            if r["remnant_length"] >= 10 and r["remnant_area"] > 0:
                remnants_produced.append({
                    "width": mw,
                    "length": r["remnant_length"],
                    "area": r["remnant_area"],
                    "consumed": False
                })

            for s in r["sections"]:
                if s["width_waste_mm"] >= 150 and s["section_length"] >= 10:
                    remnants_produced.append({
                        "width": s["width_waste_mm"],
                        "length": s["section_length"],
                        "area": s["width_waste_mm"] * s["section_length"],
                        "consumed": False
                    })

        if raw_allocated_area == 0 and plan:
            raw_allocated_area = sum(r["roll_area"] for r in plan)

        active_remnants = [rem for rem in remnants_produced if not rem["consumed"]]
        total_active_remnant = sum(rem["area"] for rem in active_remnants)
        net_scrap = max(0, raw_allocated_area - total_product_cut - total_active_remnant)
        net_scrap_pct = round(net_scrap / (raw_allocated_area or 1) * 100, 2)
        material_yield_pct = round(total_product_cut / (raw_allocated_area or 1) * 100, 2)
        overall_utilization_pct = round((total_product_cut + total_active_remnant) / (raw_allocated_area or 1) * 100, 2)

        # Compute unfulfilled orders: demand - what was actually placed in the plan
        placed = {}
        for r in plan:
            for s in r["sections"]:
                for (w, l), q in s["assignment"].items():
                    placed[(w, l)] = placed.get((w, l), 0) + q
        unfulfilled_2d = []
        for (w, l), demanded in orders_dict.items():
            cut = placed.get((w, l), 0)
            if cut < demanded:
                unfulfilled_2d.append({"width": w, "length": l, "quantity": demanded - cut})

        return jsonify({
            "summary": {
                "rolls_used":                  len(plan),
                "raw_master_rolls_count":      raw_rolls_count or len(plan),
                "total_product_cut_area":      total_product_cut,
                "total_roll_area_allocated":   raw_allocated_area,
                "total_reusable_remnant":      total_active_remnant,
                "net_scrap_area":              net_scrap,
                "net_scrap_pct":               net_scrap_pct,
                "slitting_efficiency_pct":     material_yield_pct,
                "overall_roll_utilization_pct": overall_utilization_pct,
            },
            "plan": formatted_plan,
            "remaining_inventory": {
                f"{w}_{l}": (q if q < float("inf") else None)
                for (w, l), q in remaining_stock.items()
            },
            "unfulfilled_orders": unfulfilled_2d
        })
    except Exception as ex:
        return jsonify({"error": f"2D Optimization error: {str(ex)}"}), 500


# Jumbo sizes the paper machine can make, for sizes designed from the order pool.
# Widths/lengths of stock rolls already in use extend these limits automatically.
JUMBO_MIN_WIDTH, JUMBO_MAX_WIDTH = 1000, 2000     # mm
JUMBO_MIN_LENGTH, JUMBO_MAX_LENGTH = 4000, 8000   # m


@app.route("/api/suggest-rolls-2d", methods=["POST"])
def suggest_rolls_2d():
    """For unfulfilled 2D orders, work out how many full master rolls of each
    candidate size (stock sizes and/or a custom size) are needed, and the waste."""
    if gen_model_2d is None:
        return jsonify({"error": "2D ML model is not loaded. Please verify 2D model files."}), 500

    data = request.get_json(force=True, silent=True) or {}
    # Roll-count estimate: beam 4 gives the same counts as 16 at ~4x the speed
    beam_w = int(data.get("beam_width", 4))
    try:
        orders_dict = {}
        for o in data.get("orders", []):
            w, l = int(o.get("width", 0)), int(o.get("length", 0))
            q = int(o.get("quantity", o.get("qty", 0)))
            if w > 0 and l > 0 and q > 0:
                orders_dict[(w, l)] = orders_dict.get((w, l), 0) + q
        candidates = []
        for c in data.get("candidates", []):
            w, l = int(c.get("width", 0)), int(c.get("length", 0))
            if w > 0 and l > 0 and (w, l) not in candidates:
                candidates.append((w, l))
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid orders or candidate sizes."}), 400

    if not orders_dict or not candidates:
        return jsonify({"error": "Orders and at least one candidate roll size are required."}), 400

    total_pieces = sum(orders_dict.values())
    # quick: answer at once from the estimate (no exact re-check of the counts).
    # The panel shows that immediately and then asks again without quick to verify.
    quick = bool(data.get("quick"))

    # Exploring sizes and mixes uses the core solver (fast); the final check of the
    # recommended counts uses the full solver with lane stacking, like the real plan.
    def solve(sizes, pieces):
        return solver_2d._solve_2d_core(
            list(sizes), pieces, gen_model_2d, pool_feats_2d,
            scorer_model=scorer_model_2d, scorer_features=scorer_feats_2d,
            roll_inventory=None, beam_width=beam_w
        )

    def plan_stats(plan):
        placed = sum(q for r in plan for s in r["sections"] for q in s["assignment"].values())
        used = sum(r["total_used_area"] for r in plan)
        allocated = sum(r["roll_area"] for r in plan)
        waste = sum(r["total_waste_area"] for r in plan)
        reusable = sum(r.get("total_reusable_area", r["remnant_area"]) for r in plan)
        scrap = max(0, waste - reusable)
        return {
            "rolls_needed": len(plan),
            "pieces_covered": placed,
            "scrap_pct": round(scrap / allocated * 100, 2) if allocated else None,
            "utilization_pct": round(used / allocated * 100, 2) if allocated else None,
            "reusable_area": reusable,
            "covers_all": placed >= total_pieces,
            "_allocated": allocated,
        }

    # Exact roll counts are checked with the same search width as the real 2D plan
    # (/api/optimize-2d, beam 16), so the numbers shown match what a re-plan will do.
    VERIFY_BEAM = 16

    def solve_fixed(counts, beam=VERIFY_BEAM):
        inv = {k: n for k, n in counts.items() if n > 0}
        fits = [(w, l, q) for (w, l), q in orders_dict.items()
                if any(w <= mw and l <= ml for (mw, ml) in inv)]
        if not inv or not fits:
            return []
        return solver_2d.solve_2d(
            list(inv), fits, gen_model_2d, pool_feats_2d,
            scorer_model=scorer_model_2d, scorer_features=scorer_feats_2d,
            roll_inventory=dict(inv), beam_width=beam
        )

    def placed_in(plan):
        return sum(q for r in plan for s in r["sections"] for q in s["assignment"].values())

    def fixed_stats(counts, plan):
        # Every roll made counts as material, even one the plan does not need
        allocated = sum(w * l * n for (w, l), n in counts.items())
        placed = placed_in(plan)
        used = sum(r["total_used_area"] for r in plan)
        return {
            "rolls_needed": sum(counts.values()),
            "pieces_covered": placed,
            "covers_all": placed >= total_pieces,
            "utilization_pct": round(used / allocated * 100, 2) if allocated else None,
        }

    # Evaluate a user-edited mix: exactly these roll counts per size.
    if data.get("evaluate"):
        try:
            inv = {}
            for b in data.get("inventory", []):
                w, l, n = int(b.get("width", 0)), int(b.get("length", 0)), int(b.get("rolls", 0))
                if w > 0 and l > 0 and n > 0:
                    inv[(w, l)] = inv.get((w, l), 0) + n
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid roll counts."}), 400
        plan = solve_fixed(inv)
        st = fixed_stats(inv, plan)
        return jsonify({"evaluation": {
            "pieces_covered": st["pieces_covered"],
            "pieces_total": total_pieces,
            "covers_all": st["covers_all"],
            "utilization_pct": st["utilization_pct"],
            "rolls_made": sum(inv.values()),
            "rolls_used": len(plan),
        }})

    def roll_pieces(roll):
        pieces = {}
        for s in roll["sections"]:
            for k, q in s["assignment"].items():
                if q > 0:
                    pieces[k] = pieces.get(k, 0) + q
        return pieces

    results = []
    base_plans = {}

    def evaluate(mw, ml):
        fitting = [(w, l, q) for (w, l), q in orders_dict.items() if w <= mw and l <= ml]
        not_fitting = sum(q for (w, l), q in orders_dict.items() if w > mw or l > ml)
        entry = {"width": mw, "length": ml, "rolls_needed": 0, "pieces_covered": 0,
                 "pieces_total": total_pieces, "pieces_not_fitting": not_fitting,
                 "scrap_pct": None, "utilization_pct": None, "reusable_area": 0,
                 "covers_all": False}
        if fitting:
            try:
                plan = solve([(mw, ml)], fitting)
                base_plans[(mw, ml)] = plan
                stats = plan_stats(plan)
                stats.pop("_allocated")
                entry.update(stats)
            except Exception as ex:
                entry["error"] = str(ex)
        results.append(entry)
        return entry

    for (mw, ml) in list(candidates):
        evaluate(mw, ml)

    # ── Mixed-size plan: manufacture several master sizes together ──────────
    # One size for every roll wastes material whenever a roll is only partly filled.
    # Strategies tried, best one wins:
    #  a) solve with all sizes available at once
    #  b) per base size: take its plan, re-cut each roll's pieces on a smaller size
    #     when that uses less material, then plan the pieces it could not fit
    #  c) length buckets: each order goes to the shortest roll length it fits
    #     (e.g. <= 7,000 m pieces on 7,000 m rolls, 7,800 m pieces on 8,000 m rolls)
    def downsize(plan, sizes):
        out = []
        for r in plan:
            pieces = roll_pieces(r)
            n = sum(pieces.values())
            best, best_area = [r], r["roll_area"]
            for (mw, ml) in sizes:
                if (mw, ml) == (r["master_width"], r["master_length"]) or mw * ml >= best_area:
                    continue
                if any(w > mw or l > ml for (w, l) in pieces):
                    continue
                try:
                    sub = solve([(mw, ml)], [(w, l, q) for (w, l), q in pieces.items()])
                except Exception:
                    continue
                sub_placed = sum(q for x in sub for s in x["sections"] for q in s["assignment"].values())
                sub_area = sum(x["roll_area"] for x in sub)
                if sub_placed >= n and sub_area < best_area:
                    best, best_area = sub, sub_area
            out.extend(best)
        return out

    def with_leftover(plan, sizes):
        left = dict(orders_dict)
        for r in plan:
            for k, q in roll_pieces(r).items():
                left[k] = left.get(k, 0) - q
        leftover = [(w, l, q) for (w, l), q in left.items()
                    if q > 0 and any(w <= mw and l <= ml for (mw, ml) in sizes)]
        if leftover:
            try:
                plan = plan + downsize(solve(sizes, leftover), sizes)
            except Exception:
                pass
        return plan

    def bucket_plan(sizes):
        lengths = sorted({l for _, l in sizes})
        groups = {}
        for (w, l), q in orders_dict.items():
            L = next((L for L in lengths if L >= l and any(sw >= w for sw, sl in sizes if sl == L)), None)
            if L is not None:
                groups.setdefault(L, []).append((w, l, q))
        plan = []
        for L, pieces in groups.items():
            try:
                plan += solve([s for s in sizes if s[1] == L], pieces)
            except Exception:
                pass
        return with_leftover(downsize(plan, sizes), sizes)

    def best_plan(plans):
        scored = [(plan_stats(p), p) for p in plans if p]
        if not scored:
            return None
        # Within ~1% material use, prefer fewer rolls to manufacture
        return max(scored, key=lambda x: (x[0]["pieces_covered"], round(x[0]["utilization_pct"] or 0), -x[0]["rolls_needed"]))[1]

    def mix_plan(sizes):
        trials = []
        fits_any = [(w, l, q) for (w, l), q in orders_dict.items()
                    if any(w <= mw and l <= ml for (mw, ml) in sizes)]
        try:
            trials.append(downsize(solve(sizes, fits_any), sizes))
        except Exception:
            pass
        for size in sizes:
            if size in base_plans:
                trials.append(with_leftover(downsize(base_plans[size], sizes), sizes))
        trials.append(bucket_plan(sizes))
        return best_plan(trials)

    # Order-pool sizes: jumbo sizes designed from the orders themselves, so rolls are
    # manufactured to be used fully (e.g. 3 x 500 mm pieces x 6,800 m -> 1,500 x 6,800).
    # Unlike fitted sizes these can be wider than any stock roll, within machine limits.
    def order_pool_sizes(max_sizes=3):
        stock_w = [w for w, _ in candidates]
        stock_l = [l for _, l in candidates]
        w_min = JUMBO_MIN_WIDTH
        w_max = max([JUMBO_MAX_WIDTH] + stock_w)
        l_min = JUMBO_MIN_LENGTH
        l_max = max([JUMBO_MAX_LENGTH] + stock_l)
        # Group pieces that share a jumbo length. Short pieces (many runs per jumbo)
        # form one group; long ones are grouped only when within 5% of each other,
        # so e.g. 6,800 m pieces get their own ~6,800 m jumbo instead of 8,000 m.
        groups, seen = [], set()
        short = {k: q for k, q in orders_dict.items() if k[1] * 2 <= l_min}
        if short:
            groups.append((None, short))
            seen.update(short)
        for L in sorted({k[1] for k in orders_dict if k not in seen}, reverse=True):
            g = {(w, l): q for (w, l), q in orders_dict.items()
                 if (w, l) not in seen and l <= L and (L - l) <= 0.05 * L}
            if not g or L > l_max:
                continue
            seen.update(g)
            # Jumbo length: as many runs of L as fit, rounded up to 100 m
            k = l_max // L
            groups.append((min(l_max, max(l_min, -(-(k * L) // 100) * 100)), g))
        groups.sort(key=lambda x: -sum(w * l * q for (w, l), q in x[1].items()))

        def jumbo_length(W, g):
            # Short pieces: size the length to the demand so the rolls come out full
            # (3% slack for run ends), split over as few rolls as the length limit allows
            area = sum(w * l * q for (w, l), q in g.items()) * 1.03
            n = max(1, -(-int(area) // (W * l_max)))
            return min(l_max, max(l_min, -(-int(area / (n * W)) // 100) * 100))

        picks = []
        for jl, g in groups[:max_sizes]:
            # Widths whose sum exactly hits a jumbo width (no side trim): bounded knapsack
            avail = {}
            for (w, l), q in g.items():
                avail[w] = avail.get(w, 0) + q
            reach = {0}
            for w, q in avail.items():
                for _ in range(min(q, w_max // w)):
                    reach |= {s + w for s in reach if s + w <= w_max}
            widths = sorted((s for s in reach if s >= w_min), reverse=True)[:3]
            best = None
            for W in widths:
                L = jl or jumbo_length(W, g)
                try:
                    p = solve([(W, L)], [(w, l, q) for (w, l), q in g.items()])
                except Exception:
                    continue
                st = plan_stats(p)
                if st["pieces_covered"] < sum(g.values()):
                    continue
                score = (st["utilization_pct"] or 0, W)
                if best is None or score > best[0]:
                    best = (score, (W, L), p)
            if best and best[1] not in picks:
                picks.append(best[1])
                pool_plan.extend(best[2])
        return picks

    pool_plan = []   # each order group cut on its own designed size (filled by order_pool_sizes)

    want_mix = data.get("mix") and (len(candidates) >= 2 or data.get("fitted"))
    plan = mix_plan(candidates) if want_mix else None

    # Fitted sizes: rolls are being manufactured, so a roll that is only partly used
    # can be made to the width × length the plan actually uses (width rounded up to
    # 50 mm, length to 100 m). Offered as extra sizes, then the mix is re-planned.
    if want_mix and data.get("fitted"):
        fitted = {}
        sources = [plan or []] + list(base_plans.values())
        for p in sources:
            for r in p:
                mw, ml = r["master_width"], r["master_length"]
                uw = max((s["used_width_mm"] for s in r["sections"]), default=0)
                fw = min(mw, -(-uw // 50) * 50)
                fl = min(ml, -(-r["length_used"] // 100) * 100)
                # Fitted rolls stay real master rolls: at least 60% of the original width
                # (a master roll as narrow as one order piece is just making the order itself)
                fw = max(fw, -(-int(0.6 * mw) // 50) * 50)
                # Same for length: a nearly empty last roll (e.g. 400 m used of 4,000 m)
                # is not a jumbo size worth making all orders on (that took 30 rolls)
                fl = max(fl, -(-int(0.6 * ml) // 100) * 100)
                if fw <= 0 or fl <= 0 or fw * fl > 0.9 * mw * ml or (fw, fl) in candidates:
                    continue
                fitted[(fw, fl)] = fitted.get((fw, fl), 0) + (mw * ml - fw * fl)
        new_sizes = [k for k, _ in sorted(fitted.items(), key=lambda x: -x[1])[:4]]
        for (fw, fl) in new_sizes:
            candidates.append((fw, fl))
            evaluate(fw, fl)["fitted"] = True
        pool = [k for k in order_pool_sizes() if k not in candidates]
        for (pw, pl) in pool:
            candidates.append((pw, pl))
            evaluate(pw, pl)["from_orders"] = True
        new_sizes += pool
        if new_sizes:
            plan = best_plan([plan, plan and with_leftover(downsize(plan, candidates), candidates),
                              bucket_plan(candidates),
                              pool_plan and with_leftover(list(pool_plan), candidates)])

    # Recommend: covers all pieces -> least material left over -> fewest rolls
    feasible = [r for r in results if r["covers_all"] and r["utilization_pct"] is not None]
    best_single = max(feasible, key=lambda r: (r["utilization_pct"], -r["rolls_needed"])) if feasible else None

    mix = None
    if plan:
        stats = plan_stats(plan)
        stats.pop("_allocated")
        counts = {}
        for r in plan:
            k = (r["master_width"], r["master_length"])
            counts[k] = counts.get(k, 0) + 1
        mix = dict(stats, pieces_total=total_pieces, breakdown=[
            {"width": w, "length": l, "rolls": counts.get((w, l), 0)} for (w, l) in candidates
        ])
        # Only worth recommending if it really mixes sizes and beats the best single size
        sizes_used = sum(1 for c in counts.values() if c > 0)
        if (sizes_used >= 2 and mix["covers_all"]
                and (best_single is None or (mix["utilization_pct"] or 0) > best_single["utilization_pct"] + 0.5)):
            mix["recommended"] = True

    if best_single and not (mix and mix.get("recommended")):
        best_single["recommended"] = True

    # ── Tighten the recommended counts ───────────────────────────────────────
    # Re-plan the suggested counts exactly as the real plan will. If a piece does
    # not fit, add a roll; then drop one roll at a time (largest size first) while
    # every piece still fits. Time-boxed so the panel stays responsive.
    def tighten(counts, budget_s=40):
        t0 = time.time()
        target = sum(q for (w, l), q in orders_dict.items()
                     if any(w <= mw and l <= ml for (mw, ml), n in counts.items() if n > 0))
        counts = {k: n for k, n in counts.items() if n > 0}
        plan = solve_fixed(counts)
        for _ in range(3):
            if placed_in(plan) >= target or time.time() - t0 > budget_s:
                break
            k = max(counts, key=counts.get)
            counts[k] += 1
            plan = solve_fixed(counts)
        if placed_in(plan) < target:
            return counts, plan
        # Rolls the plan did not need are dropped straight away
        used = {}
        for r in plan:
            k = (r["master_width"], r["master_length"])
            used[k] = used.get(k, 0) + 1
        counts = {k: used.get(k, 0) for k in counts}
        # Drop trials use a narrower search (beam 4); the counts they settle on are
        # then re-checked once with the full search the real plan uses.
        verified_counts, verified_plan = counts, plan
        improved = True
        while improved and time.time() - t0 < budget_s:
            improved = False
            for k in sorted(counts, key=lambda k: -k[0] * k[1]):
                if counts[k] <= 0 or time.time() - t0 > budget_s:
                    continue
                trial = dict(counts)
                trial[k] -= 1
                p = solve_fixed(trial, beam=4)
                if placed_in(p) >= target:
                    counts, improved = trial, True
                    break
        if counts != verified_counts:
            plan = solve_fixed(counts)
            if placed_in(plan) < target:
                return verified_counts, verified_plan
        return counts, plan

    try:
        if quick:
            pass
        elif mix and (mix.get("recommended") or not data.get("fitted")):
            counts, tplan = tighten({(b["width"], b["length"]): b["rolls"] for b in mix["breakdown"]})
            mix.update(fixed_stats(counts, tplan))
            for b in mix["breakdown"]:
                b["rolls"] = counts.get((b["width"], b["length"]), 0)
            mix["verified"] = True
        elif best_single:
            size = (best_single["width"], best_single["length"])
            counts, tplan = tighten({size: best_single["rolls_needed"]})
            best_single.update(fixed_stats(counts, tplan))
            best_single["verified"] = True
    except Exception as ex:
        logging.getLogger(__name__).warning("tighten failed: %s", ex)

    return jsonify({"suggestions": results, "mix": mix})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f" * RollCut OS server running on http://localhost:{port} (Press CTRL+C to quit)", flush=True)
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
