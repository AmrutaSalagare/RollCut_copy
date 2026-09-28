# -*- coding: utf-8 -*-
"""
train_2d.py — Train Regularized ML Models for 2D Roll Cutting Optimization
==========================================================================
Model 1 (combo_generator_2d):  Multi-Output XGBoost
  Input : pool state + length multiplicity features (len_multiplier, knives_needed, fit_rem)
  Output: knives assigned per customer slot for the section
  Regularized: max_depth=5, min_child_weight=10, subsample=0.8 (prevents memorization)

Model 2 (waste_scorer_2d):     Single-Output XGBoost
  Input : candidate knife assignments + dimensions
  Output: predicted area waste percentage (value function)
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error
from sklearn.multioutput import MultiOutputRegressor
import xgboost as xgb
import joblib

DATA_PATH    = "cutting_stock_2d_dataset.csv"
MODEL_PATH   = "cutting_stock_2d_model.pkl"
NUM_SLOTS    = 10
RANDOM_STATE = 42

# ── Feature Definitions ────────────────────────────────────────────────────────

POOL_FEATURES = (
    ["master_roll_width", "master_roll_length", "master_length_remaining",
     "length_remaining_ratio", "section_length", "section_length_ratio"]
    + [f for i in range(1, NUM_SLOTS + 1)
       for f in (f"pool_cust{i}_width",          f"pool_cust{i}_length",
                 f"pool_cust{i}_qty",            f"pool_cust{i}_area_left",
                 f"pool_cust{i}_width_fit",      f"pool_cust{i}_width_ratio",
                 f"pool_cust{i}_fit_rem",        f"pool_cust{i}_len_multiplier",
                 f"pool_cust{i}_len_mod_ratio",  f"pool_cust{i}_knives_needed")]
    + ["pool_total_remaining_area", "pool_n_active",
       "pool_avg_width",   "pool_std_width",
       "pool_avg_length",  "pool_std_length",
       "pool_max_width",   "pool_min_width",
       "pool_max_length",  "pool_min_length",
       "pool_area_utilization"]
)

TARGET_COLS = [f"assign_cust{i}_knives" for i in range(1, NUM_SLOTS + 1)]

SCORER_FEATURES = (
    ["master_roll_width", "section_length", "width_utilization_ratio", "width_trim_ratio"]
    + [f for i in range(1, NUM_SLOTS + 1)
       for f in (f"pool_cust{i}_width", f"pool_cust{i}_length", f"assign_cust{i}_knives")]
    + ["used_width_mm"]
)
SCORER_TARGET = "net_scrap_pct"


# ── 1. Load + Feature Engineering ─────────────────────────────────────────────

def load_and_engineer(path):
    df = pd.read_csv(path)
    print(f"  Raw dataset rows: {len(df)} | columns: {len(df.columns)}")

    if "length_remaining_ratio" not in df.columns:
        df["length_remaining_ratio"] = (
            df["master_length_remaining"] / df["master_roll_length"]
        ).round(4)

    if "section_length_ratio" not in df.columns:
        df["section_length_ratio"] = np.where(
            df["master_length_remaining"] > 0,
            (df["section_length"] / df["master_length_remaining"]).round(4),
            0.0
        )

    df["width_utilization_ratio"] = np.where(
        df["master_roll_width"] > 0,
        (df["used_width_mm"] / df["master_roll_width"]).round(4),
        0.0
    )

    if "width_trim_ratio" not in df.columns:
        df["width_trim_ratio"] = np.where(
            df["master_roll_width"] > 0,
            ((df["master_roll_width"] - df["used_width_mm"]) / df["master_roll_width"]).round(4),
            0.0
        )

    for i in range(1, NUM_SLOTS + 1):
        if f"assign_cust{i}_knives" not in df.columns:
            if f"assign_cust{i}_qty" in df.columns:
                df[f"assign_cust{i}_knives"] = df[f"assign_cust{i}_qty"].fillna(0).astype(int)
            else:
                df[f"assign_cust{i}_knives"] = 0

        w_col = f"pool_cust{i}_width"
        l_col = f"pool_cust{i}_length"
        q_col = f"pool_cust{i}_qty"
        if w_col in df.columns:
            w_series = df[w_col].fillna(0)
            l_series = df[l_col].fillna(0)
            q_series = df[q_col].fillna(0)
            mw_series = df["master_roll_width"]
            sec_len_series = df["section_length"]

            if f"pool_cust{i}_width_fit" not in df.columns:
                df[f"pool_cust{i}_width_fit"] = np.where(w_series > 0, mw_series // np.maximum(w_series, 1), 0)
            if f"pool_cust{i}_width_ratio" not in df.columns:
                df[f"pool_cust{i}_width_ratio"] = np.where(mw_series > 0, (w_series / mw_series).round(4), 0.0)
            if f"pool_cust{i}_fit_rem" not in df.columns:
                df[f"pool_cust{i}_fit_rem"] = np.where(w_series > 0, ((mw_series % np.maximum(w_series, 1)) / mw_series).round(4), 1.0)
            if f"pool_cust{i}_len_multiplier" not in df.columns:
                df[f"pool_cust{i}_len_multiplier"] = np.where((l_series > 0) & (l_series <= sec_len_series), sec_len_series // np.maximum(l_series, 1), 0)
            if f"pool_cust{i}_len_mod_ratio" not in df.columns:
                df[f"pool_cust{i}_len_mod_ratio"] = np.where(sec_len_series > 0, ((sec_len_series % np.maximum(l_series, 1)) / sec_len_series).round(4), 1.0)
            if f"pool_cust{i}_knives_needed" not in df.columns:
                mult = df[f"pool_cust{i}_len_multiplier"]
                df[f"pool_cust{i}_knives_needed"] = np.where(mult > 0, np.ceil(q_series / np.maximum(mult, 1)).astype(int), 0)

    if "pool_max_width" not in df.columns:
        w_cols = [f"pool_cust{i}_width" for i in range(1, NUM_SLOTS + 1) if f"pool_cust{i}_width" in df.columns]
        df["pool_max_width"] = df[w_cols].max(axis=1)
        df["pool_min_width"] = df[w_cols].replace(0, np.nan).min(axis=1).fillna(0)
    if "pool_max_length" not in df.columns:
        l_cols = [f"pool_cust{i}_length" for i in range(1, NUM_SLOTS + 1) if f"pool_cust{i}_length" in df.columns]
        df["pool_max_length"] = df[l_cols].max(axis=1)
        df["pool_min_length"] = df[l_cols].replace(0, np.nan).min(axis=1).fillna(0)
    if "net_scrap_pct" not in df.columns:
        width_trim = df["master_roll_width"] - df["used_width_mm"]
        reusable_w = np.where(width_trim >= 150, width_trim * df["section_length"], 0)
        tot_waste = df["master_roll_width"] * df["section_length"] * (df["waste_area_pct"] / 100.0)
        df["net_scrap_pct"] = np.maximum(0, (tot_waste - reusable_w) / (df["master_roll_width"] * df["section_length"]) * 100).round(4)

    print(f"  Average ground-truth net scrap: {df[SCORER_TARGET].mean():.2f}%")
    return df


# ── 2. Train Combo Generator (Multi-Output Regularized XGBoost) ───────────────

def train_combo_generator(df):
    print("\n--- Model 1: 2D Combo Generator (Multi-Output XGBoost) ---")

    mask = df[TARGET_COLS].sum(axis=1) > 0
    df_f = df[mask].copy()

    feats = [f for f in POOL_FEATURES if f in df_f.columns]
    missing = [f for f in POOL_FEATURES if f not in df_f.columns]
    if missing:
        print(f"  Note: skipped missing features: {missing}")

    X = df_f[feats]
    Y = df_f[TARGET_COLS]

    X_train, X_test, Y_train, Y_test = train_test_split(
        X, Y, test_size=0.2, random_state=RANDOM_STATE
    )
    print(f"  Train samples: {len(X_train)} | Test samples: {len(X_test)} | Features: {len(feats)}")

    # Regularized parameters to learn generalized heuristics without memorization:
    # max_depth=5, min_child_weight=10, subsample=0.8, colsample=0.8
    base = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.035,
        subsample=0.8,
        colsample_bytree=0.8,
        colsample_bylevel=0.8,
        min_child_weight=10,
        gamma=0.1,
        reg_alpha=0.1,
        reg_lambda=2.0,
        objective="reg:squarederror",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    model = MultiOutputRegressor(base, n_jobs=-1)
    model.fit(X_train, Y_train)

    Y_pred = model.predict(X_test)
    maes  = [mean_absolute_error(Y_test.iloc[:, i], Y_pred[:, i]) for i in range(NUM_SLOTS)]
    rmses = [mean_squared_error(Y_test.iloc[:, i],  Y_pred[:, i]) ** 0.5 for i in range(NUM_SLOTS)]
    r2s   = [r2_score(Y_test.iloc[:, i], Y_pred[:, i]) for i in range(NUM_SLOTS)]

    exact_pct = []
    for i in range(NUM_SLOTS):
        rounded = np.round(Y_pred[:, i]).clip(0)
        exact_pct.append((rounded == Y_test.iloc[:, i].values).mean() * 100)

    print(f"\n  {'Slot':<22} {'MAE':>7} {'RMSE':>7} {'R2':>7} {'Exact%':>8}")
    print("  " + "-" * 56)
    for i, col in enumerate(TARGET_COLS):
        print(f"  {col:<22} {maes[i]:>7.4f} {rmses[i]:>7.4f} {r2s[i]:>7.4f} {exact_pct[i]:>7.1f}%")

    avg_mae = np.mean(maes)
    avg_r2  = np.mean(r2s)
    avg_ex  = np.mean(exact_pct)
    print(f"\n  Avg MAE   : {avg_mae:.4f}")
    print(f"  Avg R2    : {avg_r2:.4f}")
    print(f"  Avg Exact : {avg_ex:.1f}%")

    return model, feats


# ── 3. Train Waste Scorer (Single-Output XGBoost) ─────────────────────────────

def train_waste_scorer(df):
    print("\n--- Model 2: 2D Area Waste Scorer (XGBoost) ---")

    feats = [f for f in SCORER_FEATURES if f in df.columns]
    missing = [f for f in SCORER_FEATURES if f not in df.columns]
    if missing:
        print(f"  Note: skipped missing features: {missing}")

    X = df[feats]
    y = df[SCORER_TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE
    )

    scorer = xgb.XGBRegressor(
        n_estimators=250,
        max_depth=5,
        learning_rate=0.035,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=10,
        reg_alpha=0.1,
        reg_lambda=2.0,
        objective="reg:squarederror",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    scorer.fit(X_train, y_train)

    y_pred = scorer.predict(X_test)
    mae  = mean_absolute_error(y_test, y_pred)
    rmse = mean_squared_error(y_test, y_pred) ** 0.5
    r2   = r2_score(y_test, y_pred)

    print(f"  MAE  : {mae:.2f}%")
    print(f"  RMSE : {rmse:.2f}%")
    print(f"  R2   : {r2:.4f}")

    return scorer, feats


# ── 4. Main Pipeline ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("Training 2D Roll Cutting ML System (Regularized, Large Scale)")
    print("=" * 60)

    df = load_and_engineer(DATA_PATH)

    gen_model, pool_feats = train_combo_generator(df)
    scorer_model, scorer_feats = train_waste_scorer(df)

    payload = {
        "combo_generator_2d": gen_model,
        "waste_scorer_2d":    scorer_model,
        "pool_features":      pool_feats,
        "target_cols":        TARGET_COLS,
        "scorer_features":    scorer_feats,
        "version":            "3.1-large-scale"
    }
    joblib.dump(payload, MODEL_PATH)
    print(f"\n[SUCCESS] Saved trained models to {MODEL_PATH}")
