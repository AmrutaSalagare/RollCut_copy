# -*- coding: utf-8 -*-
"""
app.py - Enterprise API and Web Server for 1D Roll Cutting Optimization
"""

import os
import sys
import logging
import flask.cli
from flask import Flask, request, jsonify, send_from_directory
from solver_v2 import load_models, solve

# Suppress Flask server banner and request logging
flask.cli.show_server_banner = lambda *args: None
logging.getLogger("werkzeug").setLevel(logging.ERROR)

app = Flask(__name__, static_folder="static")

# Load 1D ML models
try:
    gen_model, _, pool_feats, _, _ = load_models()
except Exception as e:
    gen_model, pool_feats = None, None

# Load 2D ML models
try:
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
                roll_widths.append(w)
                roll_inventory[w] = q

        # Also merge any roll_inventory passed directly
        if isinstance(roll_inv_raw, dict):
            for k, v in roll_inv_raw.items():
                w = int(k)
                q = int(v) if v is not None and str(v).strip() != "" and int(v) >= 0 else None
                if w > 0:
                    if w not in roll_widths:
                        roll_widths.append(w)
                    roll_inventory[w] = q
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
                if q is not None and q > 0:
                    inventory[(w, l)] = q
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

    try:
        import solver_2d
        import importlib
        importlib.reload(solver_2d)
        plan, remaining_stock = solver_2d.solve_2d(
            master_rolls, orders, gen_model_2d, pool_feats_2d,
            scorer_model=scorer_model_2d, scorer_features=scorer_feats_2d,
            roll_inventory=inventory if inventory else None,
            beam_width=beam_w,
            return_inventory=True
        )

        formatted_plan = []
        for r in plan:
            formatted_secs = []
            for s in r["sections"]:
                cuts_list = [
                    {"width": w, "length": l, "quantity": q}
                    for (w, l), q in sorted(s["assignment"].items(), reverse=True)
                ]
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
            }
        })
    except Exception as ex:
        return jsonify({"error": f"2D Optimization error: {str(ex)}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f" * RollCut OS server running on http://localhost:{port} (Press CTRL+C to quit)", flush=True)
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
