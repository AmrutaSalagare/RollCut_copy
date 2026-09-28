# -*- coding: utf-8 -*-
"""
train_model_v2.py - Train ML Combo Generator + Waste Scorer (PURE ML)
=====================================================================
CRITICAL FIX: Train generator model ONLY on optimal solutions (waste < 10%).
The scorer model trains on ALL data (it needs to identify bad patterns too).

Model 1 (combo_generator): Multi-output XGBoost
  Input:  pool state (what widths remain, how many)
  Output: how many of each customer slot to assign to this roll
  TRAINED ON: Only rows where resulting_waste_pct < 10% (clean labels only)

Model 2 (waste_scorer):    Single-output XGBoost  
  Input:  the generated combination features
  Output: predicted waste_percentage
  TRAINED ON: ALL rows (needs to see bad solutions to identify them)
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, GroupShuffleSplit
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.multioutput import MultiOutputRegressor
import xgboost as xgb
import joblib

DATA_PATH   = "cutting_stock_dataset_v2.csv"
MODEL_PATH  = "cutting_stock_model_v2.pkl"
RANDOM_STATE = 42

# Waste threshold: Only train generator on solutions with waste below this
GENERATOR_WASTE_THRESHOLD = 10.0  # percent

# -- Pool feature columns (inputs to combo generator) --
POOL_FEATURES = [
    "roll_width",
    "pool_cust1_width", "pool_cust1_remaining", "pool_cust1_mm_left",
    "pool_cust2_width", "pool_cust2_remaining", "pool_cust2_mm_left",
    "pool_cust3_width", "pool_cust3_remaining", "pool_cust3_mm_left",
    "pool_cust4_width", "pool_cust4_remaining", "pool_cust4_mm_left",
    "pool_cust5_width", "pool_cust5_remaining", "pool_cust5_mm_left",
    "pool_total_remaining_mm", "pool_n_widths", "pool_utilization",
    "pool_max_width", "pool_min_width", "pool_avg_width", "pool_std_width",
]

# -- Target columns (what ML predicts: qty to assign per slot) --
TARGET_COLS = [
    "assign_cust1_qty", "assign_cust2_qty", "assign_cust3_qty",
    "assign_cust4_qty", "assign_cust5_qty",
]

# -- Waste scorer feature columns --
SCORER_FEATURES = [
    "roll_width",
    "pool_cust1_width", "assign_cust1_qty",
    "pool_cust2_width", "assign_cust2_qty",
    "pool_cust3_width", "assign_cust3_qty",
    "pool_cust4_width", "assign_cust4_qty",
    "pool_cust5_width", "assign_cust5_qty",
    "resulting_used_mm",
]
SCORER_TARGET = "resulting_waste_pct"


# -----------------------------------------------------------
# 1. LOAD + PREP
# -----------------------------------------------------------

def load_data(path):
    df = pd.read_csv(path)
    # Derived scorer feature: total_used from assignment
    df["resulting_used_mm"] = df["roll_width"] - df["resulting_waste_mm"]
    return df


# -----------------------------------------------------------
# 2. TRAIN MODEL 1 - COMBO GENERATOR (Multi-Output)
# -----------------------------------------------------------

def train_combo_generator(df):
    print("\n--- Model 1: Combo Generator (Multi-Output XGBoost) ---")
    
    # CRITICAL: Filter to only train on optimal/near-optimal solutions
    df_clean = df[df["resulting_waste_pct"] <= GENERATOR_WASTE_THRESHOLD].copy()
    df_dirty = df[df["resulting_waste_pct"] > GENERATOR_WASTE_THRESHOLD]
    
    print(f"  Total rows       : {len(df)}")
    print(f"  Clean rows (<={GENERATOR_WASTE_THRESHOLD}%): {len(df_clean)} ({len(df_clean)/len(df)*100:.1f}%)")
    print(f"  Filtered out     : {len(df_dirty)} rows with >{GENERATOR_WASTE_THRESHOLD}% waste")
    
    X = df_clean[POOL_FEATURES]
    Y = df_clean[TARGET_COLS]

    # Split by scenario for proper generalization testing
    scenarios = df_clean["scenario_id"].unique()
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
    train_idx, test_idx = next(gss.split(X, groups=df_clean["scenario_id"]))
    
    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    Y_train, Y_test = Y.iloc[train_idx], Y.iloc[test_idx]

    base = xgb.XGBRegressor(
        n_estimators=500, max_depth=7, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.8, min_child_weight=3,
        reg_alpha=0.1, reg_lambda=1.0,
        objective="reg:squarederror", random_state=RANDOM_STATE, n_jobs=-1,
    )
    model = MultiOutputRegressor(base, n_jobs=-1)
    model.fit(X_train, Y_train)

    Y_pred = model.predict(X_test)
    
    # Evaluate with rounding (since targets are integers)
    Y_pred_rounded = np.maximum(np.round(Y_pred), 0).astype(int)
    
    maes_raw = [mean_absolute_error(Y_test.iloc[:, i], Y_pred[:, i]) for i in range(5)]
    maes_round = [mean_absolute_error(Y_test.iloc[:, i], Y_pred_rounded[:, i]) for i in range(5)]
    r2s  = [r2_score(Y_test.iloc[:, i], Y_pred[:, i]) for i in range(5)]

    print(f"\n  Training rows : {len(X_train)}")
    print(f"  Test rows     : {len(X_test)}")
    print()
    print(f"  {'Slot':<20} {'MAE (raw)':<14} {'MAE (round)':<14} {'R2 Score'}")
    print("  " + "-" * 56)
    for i, col in enumerate(TARGET_COLS):
        print(f"  {col:<20} {maes_raw[i]:<14.4f} {maes_round[i]:<14.4f} {r2s[i]:.4f}")
    print(f"\n  Avg MAE (raw)   : {sum(maes_raw)/len(maes_raw):.4f} units")
    print(f"  Avg MAE (round) : {sum(maes_round)/len(maes_round):.4f} units")
    print(f"  Avg R2          : {sum(r2s)/len(r2s):.4f}")

    # Waste analysis on test set: simulate what the model would produce
    print("\n  Simulated Waste on Test Set:")
    waste_actual = []
    waste_predicted = []
    for idx in range(len(X_test)):
        roll_w = X_test.iloc[idx]["roll_width"]
        actual_used = sum(
            X_test.iloc[idx][f"pool_cust{j}_width"] * Y_test.iloc[idx][f"assign_cust{j}_qty"]
            for j in range(1, 6)
        )
        pred_used = sum(
            X_test.iloc[idx][f"pool_cust{j}_width"] * max(0, round(Y_pred[idx][j-1]))
            for j in range(1, 6)
        )
        # Cap at roll width
        pred_used = min(pred_used, roll_w)
        waste_actual.append((roll_w - actual_used) / roll_w * 100)
        waste_predicted.append((roll_w - pred_used) / roll_w * 100)
    
    print(f"    Actual avg waste   : {np.mean(waste_actual):.2f}%")
    print(f"    Predicted avg waste: {np.mean(waste_predicted):.2f}%")
    print(f"    Waste increase     : {np.mean(waste_predicted) - np.mean(waste_actual):+.2f}%")

    return model


# -----------------------------------------------------------
# 3. TRAIN MODEL 2 - WASTE SCORER (Single-Output)
# -----------------------------------------------------------

def train_waste_scorer(df):
    print("\n--- Model 2: Waste Scorer (XGBoost) ---")
    print(f"  Training on ALL {len(df)} rows (scorer needs to see bad solutions)")
    
    X = df[SCORER_FEATURES]
    y = df[SCORER_TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE
    )

    model = xgb.XGBRegressor(
        n_estimators=300, max_depth=7, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.8, min_child_weight=3,
        objective="reg:squarederror", random_state=RANDOM_STATE, n_jobs=-1,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2  = r2_score(y_test, y_pred)

    print(f"  Training rows : {len(X_train)}")
    print(f"  Test rows     : {len(X_test)}")
    print(f"  MAE           : {mae:.4f} %")
    print(f"  R2 Score      : {r2:.4f}")

    return model


# -----------------------------------------------------------
# 4. SAVE BOTH MODELS
# -----------------------------------------------------------

def save_models(gen_model, scorer_model, path):
    joblib.dump({
        "combo_generator":   gen_model,
        "waste_scorer":      scorer_model,
        "pool_features":     POOL_FEATURES,
        "target_cols":       TARGET_COLS,
        "scorer_features":   SCORER_FEATURES,
    }, path)
    print(f"\nBoth models saved to: {path}")


# -----------------------------------------------------------
# 5. MAIN
# -----------------------------------------------------------

if __name__ == "__main__":
    print("Loading v2 dataset...")
    df = load_data(DATA_PATH)
    print(f"  Rows: {len(df)}")
    print(f"  Columns: {len(df.columns)}")
    print(f"  Avg waste in training data: {df[SCORER_TARGET].mean():.2f}%")
    
    # Data quality summary
    zero_w = (df[SCORER_TARGET] == 0).sum()
    low_w = ((df[SCORER_TARGET] > 0) & (df[SCORER_TARGET] <= 5)).sum()
    med_w = ((df[SCORER_TARGET] > 5) & (df[SCORER_TARGET] <= 20)).sum()
    high_w = (df[SCORER_TARGET] > 20).sum()
    print(f"\n  Data Quality:")
    print(f"    0% waste     : {zero_w} ({zero_w/len(df)*100:.1f}%)")
    print(f"    0-5% waste   : {low_w} ({low_w/len(df)*100:.1f}%)")
    print(f"    5-20% waste  : {med_w} ({med_w/len(df)*100:.1f}%)")
    print(f"    >20% waste   : {high_w} ({high_w/len(df)*100:.1f}%)")

    gen_model    = train_combo_generator(df)
    scorer_model = train_waste_scorer(df)

    save_models(gen_model, scorer_model, MODEL_PATH)

    print()
    print("=" * 58)
    print("  Training complete (PURE ML).")
    print("  Model 1 (Combo Generator): trained on optimal data only")
    print("  Model 2 (Waste Scorer)   : trained on ALL data")
    print("=" * 58)
