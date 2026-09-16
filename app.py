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

# Load ML models once at server startup
try:
    gen_model, _, pool_feats, _, _ = load_models()
except Exception as e:
    gen_model, pool_feats = None, None


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
        "model_loaded": gen_model is not None,
        "version": "2.0.0"
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f" * RollCut OS server running on http://localhost:{port} (Press CTRL+C to quit)", flush=True)
    app.run(host="0.0.0.0", port=port, debug=True)
