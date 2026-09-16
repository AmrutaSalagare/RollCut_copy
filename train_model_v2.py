# -*- coding: utf-8 -*-
"""
train_model_v2.py - Train ML Combination Generator + Waste Scorer
==================================================================
Model 1 (combo_generator): Multi-output XGBoost
  Input:  pool state (what widths remain, how many)
  Output: how many of each customer slot to assign to this roll

Model 2 (waste_scorer):    Single-output XGBoost
  Input:  the generated combination features
  Output: predicted waste_percentage
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.multioutput import MultiOutputRegressor
import xgboost as xgb
import joblib

DATA_PATH   = "cutting_stock_dataset_v2.csv"
MODEL_PATH  = "cutting_stock_model_v2.pkl"
RANDOM_STATE = 42

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
    X = df[POOL_FEATURES]
    Y = df[TARGET_COLS]

    X_train, X_test, Y_train, Y_test = train_test_split(
        X, Y, test_size=0.2, random_state=RANDOM_STATE
    )

    base = xgb.XGBRegressor(
        n_estimators=300, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        objective="reg:squarederror", random_state=RANDOM_STATE, n_jobs=-1,
    )
    model = MultiOutputRegressor(base, n_jobs=-1)
    model.fit(X_train, Y_train)

    Y_pred = model.predict(X_test)
    maes = [mean_absolute_error(Y_test.iloc[:, i], Y_pred[:, i]) for i in range(5)]
    r2s  = [r2_score(Y_test.iloc[:, i], Y_pred[:, i]) for i in range(5)]

    print(f"  Training rows : {len(X_train)}")
    print(f"  Test rows     : {len(X_test)}")
    print()
    print(f"  {'Slot':<20} {'MAE (units)':<16} {'R2 Score'}")
    print("  " + "-" * 46)
    for i, col in enumerate(TARGET_COLS):
        print(f"  {col:<20} {maes[i]:<16.4f} {r2s[i]:.4f}")
    print(f"\n  Avg MAE : {sum(maes)/len(maes):.4f} units")
    print(f"  Avg R2  : {sum(r2s)/len(r2s):.4f}")

    return model


# -----------------------------------------------------------
# 3. TRAIN MODEL 2 - WASTE SCORER (Single-Output)
# -----------------------------------------------------------

def train_waste_scorer(df):
    print("\n--- Model 2: Waste Scorer (XGBoost) ---")
    X = df[SCORER_FEATURES]
    y = df[SCORER_TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE
    )

    model = xgb.XGBRegressor(
        n_estimators=200, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
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

    gen_model    = train_combo_generator(df)
    scorer_model = train_waste_scorer(df)

    save_models(gen_model, scorer_model, MODEL_PATH)

    print()
    print("=" * 48)
    print("  Training complete.")
    print("  Model 1 (Combo Generator): predicts what to cut")
    print("  Model 2 (Waste Scorer)   : validates and ranks")
    print("=" * 48)
    print()
    print("Next: build solver_v2.py")
