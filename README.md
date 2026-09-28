# 1D Roll Cutting Optimizer (ML-Driven Cutting Stock Problem)

An intelligent, end-to-end Machine Learning system for solving the **One-Dimensional Cutting Stock Problem (1D-CSP)** using **Machine Learning for Combinatorial Optimization (ML4CO)**. 

Instead of relying on slow, exponential brute-force algorithms (such as recursive Knapsack Dynamic Programming or Branch-and-Bound), this system uses a trained **Multi-Output Gradient Boosted Decision Tree model (XGBoost)** to directly predict optimal, zero-waste cutting combinations in milliseconds.

---

## 📌 Project Overview

In industrial manufacturing (paper, steel, textiles, plastics), master rolls are manufactured in standard large widths (e.g., $6000\text{mm}$, $3800\text{mm}$, $2900\text{mm}$). Customers order rolls in diverse custom widths and quantities. 

The objective is to cut the ordered widths from master rolls such that:
1. **Scrap/waste per roll is minimized** (actively targeting **0mm waste** on individual rolls).
2. **Total roll consumption is minimized**.
3. **Solving executes in real time (< 20ms)** without combinatorial explosion.

---

## 🚀 Key Features

* **ML-Driven Combinatorial Generation**: Replaces traditional brute-force knapsack loops with a predictive **MultiOutput XGBoost Regressor**.
* **High Efficiency**: Consistently achieves **95% to 99.45% overall batch efficiency**, frequently cutting major master rolls with **exact 0mm waste (100% efficiency)**.
* **Instant Solving**: Computes optimal schedules in **< 20 milliseconds per roll**, avoiding the computer lag typical of classic NP-hard solvers.
* **Dynamic Catalog & Pool Support**: Works seamlessly across multiple master roll widths and any combination of customer orders.
* **Deterministic Boundary Guard**: Combines ML pattern intelligence with strict physical constraints ($used \le roll\_width$) to guarantee machine safety and exact order fulfillment.

---

## 🧠 Machine Learning Architecture (ML4CO)

### 1. The Core ML Model
* **Algorithm**: Extreme Gradient Boosting (`xgboost.XGBRegressor`)
* **Ensemble Architecture**: `sklearn.multioutput.MultiOutputRegressor` (5 parallel coordinated tree ensembles)
* **Hyperparameters**:
  * `n_estimators = 300` (team of 300 sequential trees)
  * `max_depth = 6` (maximum 6 question levels deep to prevent overfitting)
  * `learning_rate = 0.05` (smooth, stable gradient updates)
  * `subsample = 0.8`, `colsample_bytree = 0.8` (stochastic regularization)
  * `objective = "reg:squarederror"`

### 2. State Features (Input $\mathbf{X}$ - 22 Dimensions)
Before each cut, the solver featurizes the active warehouse order state:
* **Master Roll Size**: `roll_width` (e.g., 3800mm, 6000mm)
* **Top 5 Customer Slots**: Width, remaining quantity, and total linear demand (`pool_cust{1..5}_width`, `pool_cust{1..5}_remaining`, `pool_cust{1..5}_mm_left`)
* **Global Pool Statistics**: Total remaining mm, active width count, utilization ratio, minimum/maximum width, average width, and standard deviation.

### 3. Target Outputs (Output $\mathbf{y}$ - 5 Dimensions)
* Vector: $[q_1, q_2, q_3, q_4, q_5]$
* The ML model directly predicts the **exact quantity to cut from each customer slot** to achieve zero waste on that roll.

---

## 🔄 System Workflow

```text
[Customer Orders & Master Roll Catalog]
                  │
                  ▼
       Are any orders remaining? ────(No)────► [Print Final Cutting Schedule]
                  │ (Yes)
                  ▼
  1. Extract 22-Dimensional Pool State Features
                  │
                  ▼
  2. Multi-Output XGBoost Predicts Winning Combination
                  │
                  ▼
  3. Neighbor Exploration (±1 per slot) around ML Prediction
                  │
                  ▼
  4. Objective Ranker Selects 0mm / Minimum Waste Roll
                  │
                  ▼
  5. Deduct Cut Items from Customer Pool & Repeat
```

---

## 📁 Repository Structure

| File | Description |
| :--- | :--- |
| **`main.py`** | Interactive command-line interface for entering factory orders and generating live cutting plans. |
| **`solver_v2.py`** | Core ML solver engine: state featurization, model inference, boundary guards, and roll scheduling. |
| **`train_model_v2.py`** | Training script that fits the MultiOutput XGBoost model and serializes it to disk. |
| **`generator_v2.py`** | Generates synthetic multi-roll cutting scenarios used for model training. |
| **`test_scenarios.py`** | Automated test harness evaluating 7 benchmark industrial scenarios. |
| **`cutting_stock_dataset_v2.csv`** | Pre-generated training dataset mapping warehouse states to optimal cut configurations. |
| **`cutting_stock_model_v2.pkl`** | Serialized ML model artifact loaded at runtime by the solver. |

---

## ⚙️ Installation & Setup

### 1. Prerequisites
Python 3.8+ installed with standard data science packages:
```bash
pip install pandas numpy scikit-learn xgboost joblib
```

### 2. Launch the Web Interface (Dashboard)
To launch the full interactive industrial web application:
```bash
python app.py
```
Then open your browser and navigate to:
```text
http://localhost:5000
```
Features include visual proportional cut bars, master roll tag configuration, CSV order import, and 1-click printable work orders.

### 3. Run the Command-Line Tool (Terminal Mode)
If you prefer running directly in your terminal:
```bash
python main.py
```
Follow the interactive prompts:
1. Enter available roll sizes (e.g. `1000, 2900, 3800`).
2. Enter customer widths and quantities.
3. Type `done` to immediately view the optimized plan.

### 4. Run Automated Benchmark Tests
Run the 7 benchmark test scenarios:
```bash
python test_scenarios.py
```

### 5. (Optional) Retrain the Machine Learning Model
If you modify the training dataset or hyperparameters:
```bash
python train_model_v2.py
```

---

## 📊 Example Live Result

From an actual factory order requiring **18,000mm** across 8 customer widths using rolls of `1000mm, 2900mm, 3800mm`:

```text
==========================================================
          ROLL CUTTING PLAN  [ML-Driven]
==========================================================

  Roll #1  [3800mm roll]
    Cuts       : 600mm x2, 500mm x2, 350mm x4, 100mm x2
    Used       : 3800mm  |  Waste: 0mm  |  Efficiency: 100.0%

  Roll #2  [3800mm roll]
    Cuts       : 550mm x1, 500mm x3, 400mm x3, 150mm x3, 100mm x1
    Used       : 3800mm  |  Waste: 0mm  |  Efficiency: 100.0%

  Roll #3  [3800mm roll]
    Cuts       : 800mm x2, 600mm x2, 550mm x1, 450mm x1
    Used       : 3800mm  |  Waste: 0mm  |  Efficiency: 100.0%

  Roll #4  [2900mm roll]
    Cuts       : 450mm x2, 350mm x2, 250mm x4, 150mm x2
    Used       : 2900mm  |  Waste: 0mm  |  Efficiency: 100.0%

  Roll #5  [3800mm roll]
    Cuts       : 550mm x1, 500mm x1, 450mm x5, 400mm x1
    Used       : 3700mm  |  Waste: 100mm  |  Efficiency: 97.37%

----------------------------------------------------------
  Rolls used         : 5
  Total capacity     : 18100mm
  Total used         : 18000mm
  Total waste        : 100mm
  Overall efficiency : 99.45%
==========================================================
```
* **4 out of 5 rolls cut with 0mm waste**.
* Total scrap across 18 meters of material is **only 100mm**.
* **99.45% overall efficiency**.

---

## 📦 2D Roll Cutting Optimization (Width × Length)

For full 2D roll slitting where master rolls have **width (mm) × length (m)** and orders specify **width (mm) × length (m) × quantity**:

### 1. Dual-ML Architecture
* **Model 1 (`combo_generator_2d`)**: Multi-Output XGBoost (70 features, depth 8, 450 trees) predicting the exact slitter knife arrangement per roll section.
* **Model 2 (`waste_scorer_2d`)**: Single-Output XGBoost predicting area waste percentage to validate and rank candidate patterns.
* **Beam Search Engine**: Discovers high-yield multi-roll schedules, groups orders into length-compatible sections to prevent longitudinal scrap, and repairs overwidth arrangements with greedy gap-filling.

### 2. How to Run 2D
* **Interactive CLI Tool**:
  ```bash
  python main_2d.py
  ```
  *(Press Enter to immediately run with default factory catalog and sample orders)*
* **Standalone Solver Verification**:
  ```bash
  python solver_2d.py
  ```
* **Retrain 2D ML Models**:
  ```bash
  python train_2d.py
  ```
* **2D REST API**:
  `POST /api/optimize-2d` on `http://localhost:5000` with master rolls and customer order specifications.
