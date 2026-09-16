**COMPLETE BUILD CONTEXT — 1D Cutting Stock Optimization System**

---

## **1. PROBLEM STATEMENT**

Build a system that, given:

- Jumbo roll widths (one or more different sizes, e.g., 3000mm, 2500mm, 2800mm)
- Customer orders (width × quantity needed for each customer)

Outputs:

- The best combination of customer widths mapped to each roll
- Minimum possible waste per roll and overall
- If leftover space on a roll matches another customer's needed width, that space should be utilized (not left as waste)

**Scope:** 1D only (width-based, ignore length/thickness)
**Environment:** Local laptop, Python-based, output inspectable by user
**Approach:** AI/ML-based (Hybrid: Candidate Generator + ML Scoring Model)
**Dataset:** Not required to start — synthetic data will be generated since no historical data is available
**Priority:** Accuracy and minimum waste (not "purity" of ML)
**Future flexibility:** System should allow switching to/adding Reinforcement Learning later if needed

---

## **2. CHOSEN APPROACH: HYBRID SYSTEM**

```
┌──────────────────────────────────────────────────────────┐
│  STEP 1: Candidate Generator                              │
│  - Generates multiple valid combinations of customer      │
│    widths that could fit on a given roll                  │
│  - Uses heuristic/algorithmic logic (not ML)               │
│  - Ensures all combinations are physically valid            │
│    (total width ≤ roll width)                               │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  STEP 2: ML Scoring Model                                 │
│  - Trained on synthetic data (generated combinations +     │
│    their actual waste)                                     │
│  - Scores/ranks each candidate combination by predicted    │
│    waste                                                    │
│  - THIS is where machine learning does the real work        │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  STEP 3: Selection & Output                                │
│  - Picks combination with lowest predicted/actual waste     │
│  - Repeats for remaining orders until all fulfilled          │
│  - Outputs final roll-by-roll cutting plan                  │
└──────────────────────────────────────────────────────────┘
```

**Why Hybrid:** Best fits accuracy/minimum-waste priority since candidate generation can use strong search/heuristic methods, while ML learns and improves selection quality over time.

---

## **3. DATASET (SYNTHETIC — SINCE NONE AVAILABLE)**

**Approach:** Generate synthetic training data by simulating thousands of random roll + order scenarios, computing actual waste for each using a known formula.

**Dataset Format:**

```
Roll_Width, Num_Customers_This_Roll,
Cust1_Width, Cust1_Qty, Cust2_Width, Cust2_Qty, Cust3_Width, Cust3_Qty,
Cust4_Width, Cust4_Qty, Cust5_Width, Cust5_Qty,
Total_Used_mm, Waste_mm, Waste_Percentage
```

**Example rows:**

```
3000, 3, 500, 2, 700, 1, 300, 1, 0, 0, 0, 0, 2500, 500, 16.67
3000, 2, 500, 3, 700, 1, 0, 0, 0, 0, 0, 0, 2200, 800, 26.67
2500, 1, 300, 1, 0, 0, 0, 0, 0, 0, 0, 0, 300, 2200, 88.00
3000, 4, 600, 2, 750, 2, 500, 1, 300, 2, 0, 0, 2900, 100, 3.33
```

**Generation logic:**

- Randomly pick 2-5 order widths (from a realistic range, e.g., 200mm–900mm)
- Randomly assign quantities (1-5 each)
- Randomly pick a roll width (from your available sizes, e.g., 2500/2800/3000mm)
- Try different combinations (subsets) of the orders that fit within roll width
- Calculate actual waste for each combination
- Label the best (lowest waste) combination as the "good" example, and include some suboptimal ones too (so model learns to distinguish good vs. bad)

**Target size:** 1000–3000 synthetic examples for solid training

---

## **4. FEATURES FOR ML MODEL**

**Input features (per candidate combination):**

```
- Roll_Width
- Number of distinct customer widths in this candidate
- List of widths and quantities included
- Total_Used_mm (sum of width × qty for this candidate)
- Utilization_ratio = Total_Used_mm / Roll_Width
- Remaining_space = Roll_Width - Total_Used_mm
- Width_diversity (standard deviation of widths in candidate)
```

**Target (what model predicts):**

```
Waste_Percentage = (Roll_Width - Total_Used_mm) / Roll_Width × 100
```

---

## **5. MODEL CHOICE**

**Primary Model: XGBoost Regressor**

**Why:**

- Works well with small-medium synthetic datasets (1000-3000 examples)
- Fast training and inference (<100ms)
- Handles non-linear relationships between order combinations and waste
- Interpretable (feature importance available)
- Production-ready on a laptop

**Model Parameters (starting point):**

```
n_estimators: 100-300
max_depth: 5-7
learning_rate: 0.05-0.1
objective: reg:squarederror
eval_metric: rmse
```

**Alternative (if needed later):** Random Forest Regressor (simpler baseline)

---

## **6. CANDIDATE GENERATOR LOGIC**

**Method:** Combination of heuristics to generate multiple valid options per roll:

1. **Greedy/First Fit Decreasing (FFD):** Sort orders by width descending, fill roll greedily
2. **Random sampling:** Generate several random valid subsets of orders that fit
3. **Exhaustive/near-exhaustive search (for small order lists):** Try all reasonable subset combinations directly (feasible since order lists per batch are typically small)
4. **Gap-filling logic:** Explicitly check if any remaining single-width order can fill leftover space exactly or closely (ensures the "utilize the 300mm leftover" behavior)

**Output of this stage:** A list of 10-50 valid candidate combinations per roll, each with their actual waste calculated

---

## **7. SYSTEM WORKFLOW (END-TO-END)**

```
INPUT:
  Available roll widths: [3000, 2500, 2800]
  Customer orders: [(500, 5), (700, 3), (300, 4), (600, 2)]

STEP 1: For each available roll width, generate candidate combinations
  (using candidate generator logic above)

STEP 2: Score each candidate using trained XGBoost model
  (predict waste % for each candidate)

STEP 3: Select best candidate (lowest waste) for first roll
  Assign those customer orders to Roll #1
  Remove fulfilled quantities from the order pool

STEP 4: Repeat steps 1-3 for remaining orders until:
  - All orders are fulfilled, OR
  - No more rolls available

OUTPUT:
  Roll #1 (3000mm): Customer A (500×3), Customer B (700×2), Customer C (300×1)
    Used: 2900mm | Waste: 100mm | Efficiency: 96.67%

  Roll #2 (2500mm): Customer A (500×2), Customer D (600×2), Customer C (300×1)
    Used: 2500mm | Waste: 0mm | Efficiency: 100%

  Roll #3 (2800mm): Customer B (700×1), Customer C (300×2)
    Used: 1300mm | Waste: 1500mm | Efficiency: 46.43%

  SUMMARY:
    Total waste: 1600mm
    Overall efficiency: 91.2%
```

---

## **8. TECHNOLOGY STACK**

```
Language: Python
Data handling: Pandas, NumPy
ML framework: XGBoost, Scikit-learn
Candidate generation: Custom Python logic (itertools for combinations)
Model persistence: Pickle / joblib
UI: CLI (simple) or Streamlit (if visual output wanted)
```

---

## **9. STEPS TO BUILD (IN ORDER)**

```
1. Build synthetic data generator
   → Creates realistic roll + order scenarios with computed waste

2. Build candidate generator function
   → Given orders + roll width, outputs multiple valid combinations

3. Generate training dataset
   → Run candidate generator on many synthetic scenarios
   → Save as structured dataset (CSV)

4. Feature engineering
   → Extract features from each candidate combination

5. Train XGBoost model
   → Train on synthetic dataset to predict waste %
   → Validate performance (MAE, RMSE, R²)

6. Build inference pipeline
   → New orders → generate candidates → score with model → pick best

7. Build main solving loop
   → Iteratively assign orders to rolls until all fulfilled
   → Handle multiple roll sizes

8. Build output formatter
   → Clear display: which customers on which roll, waste %, efficiency

9. Test with custom scenarios
   → Manually crafted test cases (including the "300mm leftover
     matches 300mm order" scenario)
   → Verify waste minimization works correctly

10. (Optional, future) Build RL alternative
    → Use logged real usage data from steps above to bootstrap
    → Compare performance against hybrid baseline
```

---

## **10. SUCCESS CRITERIA**

```
✅ System correctly identifies when leftover space matches another
   customer's exact needed width (utilizes it, not wasted)
✅ Waste percentage minimized across all rolls (target: <10% average)
✅ Handles multiple different roll widths simultaneously
✅ Inference time <1 second per order batch
✅ Output clearly shows customer-to-roll mapping with waste metrics
✅ System works entirely offline on local laptop
```

---

This is your complete, final context to start building. Everything — problem definition, approach, dataset strategy, model choice, system architecture, and build steps — is consolidated here.
