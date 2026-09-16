/**
 * RollCut OS - Client-Side Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  // State
  let masterRolls = []; // Array of { width: number, qty: number | null, isRemnant: boolean }
  const remnantRollSizes = new Set();
  let latestPlanData = null;
  let completedRollIds = new Set(); // Set of unique roll.uid strings marked as cut
  let rollUidCounter = 0;



  function assignRollUids(plan) {
    if (!Array.isArray(plan)) return;
    plan.forEach((roll) => {
      if (!roll.uid) {
        rollUidCounter += 1;
        roll.uid = "roll_uid_" + Date.now() + "_" + rollUidCounter + "_" + Math.random().toString(36).substr(2, 6);
      }
    });
  }

  // DOM Elements
  const rollChipsContainer = document.getElementById("roll-chips-container");
  const inputNewRoll = document.getElementById("input-new-roll");
  const inputNewRollQty = document.getElementById("input-new-roll-qty");
  const btnAddRoll = document.getElementById("btn-add-roll");
  const btnClearRolls = document.getElementById("btn-clear-rolls");

  const ordersTbody = document.getElementById("orders-tbody");
  const btnAddOrderRow = document.getElementById("btn-add-order-row");
  const btnClearOrders = document.getElementById("btn-clear-orders");
  const btnImportCsv = document.getElementById("btn-import-csv");
  const csvFileInput = document.getElementById("csv-file-input");
  const demandCounter = document.getElementById("demand-counter");

  const btnSolve = document.getElementById("btn-solve");
  const btnSolveText = document.getElementById("btn-solve-text");
  const btnReoptimize = document.getElementById("btn-reoptimize");
  const btnSpinner = document.getElementById("btn-spinner");
  const errorMessage = document.getElementById("error-message");

  const kpiSection = document.getElementById("kpi-section");
  const kpiYield = document.getElementById("kpi-yield");
  const kpiYieldSub = document.getElementById("kpi-yield-sub");
  const kpiRolls = document.getElementById("kpi-rolls");
  const kpiCapacity = document.getElementById("kpi-capacity");
  const kpiDemand = document.getElementById("kpi-demand");
  const kpiCutsCount = document.getElementById("kpi-cuts-count");
  const kpiWaste = document.getElementById("kpi-waste");
  const kpiWastePct = document.getElementById("kpi-waste-pct");

  const emptyState = document.getElementById("empty-state");
  const planContainer = document.getElementById("plan-container");
  const planStatusNote = document.getElementById("plan-status-note");

  const btnExportImg = document.getElementById("btn-export-img");
  const btnPrint = document.getElementById("btn-print");
  const btnExportTrials = document.getElementById("btn-export-trials");

  // --- Theme Management (Default: Light Theme) ---
  const btnThemeToggle = document.getElementById("btn-theme-toggle");
  const themeIconSun = document.getElementById("theme-icon-sun");
  const themeIconMoon = document.getElementById("theme-icon-moon");
  const themeLabel = document.getElementById("theme-label");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rollcut-theme", theme);
    if (theme === "dark") {
      if (themeIconSun) themeIconSun.style.display = "inline";
      if (themeIconMoon) themeIconMoon.style.display = "none";
      if (themeLabel) themeLabel.textContent = "Light Mode";
    } else {
      if (themeIconSun) themeIconSun.style.display = "none";
      if (themeIconMoon) themeIconMoon.style.display = "inline";
      if (themeLabel) themeLabel.textContent = "Dark Mode";
    }
  }

  const savedTheme = localStorage.getItem("rollcut-theme") || "light";
  applyTheme(savedTheme);

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // Distinct color palette for cut segments
  const PALETTE = [
    "#0284c7", "#0d9488", "#2563eb", "#7c3aed",
    "#059669", "#d97706", "#4f46e5", "#0891b2",
    "#16a34a", "#ca8a04", "#9333ea", "#e11d48"
  ];
  const widthColorMap = new Map();

  function getColorForWidth(w) {
    if (!widthColorMap.has(w)) {
      const idx = widthColorMap.size % PALETTE.length;
      widthColorMap.set(w, PALETTE[idx]);
    }
    return widthColorMap.get(w);
  }

  // --- Master Roll Inventory Management ---
  function syncRemnantButtons() {
    document.querySelectorAll(".btn-remnant-action").forEach((btn) => {
      const w = parseInt(btn.getAttribute("data-width"), 10);
      const exists = masterRolls.some((r) => r.width === w);
      if (exists) {
        btn.classList.add("btn-remnant-added");
        btn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>✓ Queued in Stock (${w.toLocaleString()} mm)</span>
        `;
        btn.title = "Click to remove from Master Roll Inventory";
      } else {
        btn.classList.remove("btn-remnant-added");
        btn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          <span>Use ${w.toLocaleString()} mm for Next Batch</span>
        `;
        btn.title = "Add this leftover to Master Roll Inventory for the next run";
      }
    });
  }

  function renderRollChips() {
    rollChipsContainer.innerHTML = "";
    if (masterRolls.length === 0) {
      const emptyHint = document.createElement("span");
      emptyHint.className = "empty-chips-hint";
      emptyHint.textContent = "No master roll sizes added yet. Please enter roll width(s) below.";
      rollChipsContainer.appendChild(emptyHint);
      syncRemnantButtons();
      return;
    }
    masterRolls.sort((a, b) => a.width - b.width);
    masterRolls.forEach((item) => {
      const isRemnant = item.isRemnant || remnantRollSizes.has(item.width);
      const chip = document.createElement("div");
      chip.className = `chip ${isRemnant ? "chip-remnant" : ""}`;
      const stockStr = item.qty === null ? "∞ stock" : `${item.qty} in stock`;
      const stockZeroClass = item.qty !== null && item.qty <= 0 ? "chip-stock-zero" : "";
      chip.innerHTML = `
        <span>${item.width.toLocaleString()} mm</span>
        <span class="chip-stock ${stockZeroClass}">${stockStr}</span>
        ${isRemnant ? '<span class="chip-badge-remnant">Leftover</span>' : ''}
        <span class="chip-remove" title="Remove size" data-width="${item.width}">&times;</span>
      `;
      chip.querySelector(".chip-remove").addEventListener("click", () => {
        masterRolls = masterRolls.filter((r) => r.width !== item.width);
        remnantRollSizes.delete(item.width);
        renderRollChips();
      });
      rollChipsContainer.appendChild(chip);
    });
    syncRemnantButtons();
  }

  function addRollSize() {
    const val = parseInt(inputNewRoll.value.trim(), 10);
    if (!val || val <= 0) {
      showError("Please enter a valid positive roll width in mm.");
      return;
    }
    const qStr = inputNewRollQty && inputNewRollQty.value.trim() !== "" ? inputNewRollQty.value.trim() : "";
    const qtyVal = qStr !== "" ? parseInt(qStr, 10) : null;
    if (qtyVal !== null && qtyVal < 0) {
      showError("Stock quantity cannot be negative.");
      return;
    }

    const existing = masterRolls.find((r) => r.width === val);
    if (existing) {
      if (qtyVal !== null) {
        existing.qty = (existing.qty !== null ? existing.qty : 0) + qtyVal;
      } else {
        existing.qty = null; // reset to unlimited
      }
    } else {
      masterRolls.push({ width: val, qty: qtyVal, isRemnant: false });
    }

    clearError();
    inputNewRoll.value = "";
    if (inputNewRollQty) inputNewRollQty.value = "";
    renderRollChips();
  }

  btnAddRoll.addEventListener("click", addRollSize);
  inputNewRoll.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addRollSize();
    }
  });
  if (inputNewRollQty) {
    inputNewRollQty.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addRollSize();
      }
    });
  }

  if (btnClearRolls) {
    btnClearRolls.addEventListener("click", () => {
      masterRolls = [];
      remnantRollSizes.clear();
      renderRollChips();
    });
  }

  // --- Order Table Management ---
  function createOrderRow(width = "", qty = "") {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input type="number" class="order-width" placeholder="Width (mm)" value="${width}" min="1" step="1">
      </td>
      <td>
        <input type="number" class="order-qty" placeholder="Qty (pcs)" value="${qty}" min="1" step="1">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn btn-text danger btn-sm btn-delete-row" title="Delete line">&times;</button>
      </td>
    `;

    const wInput = tr.querySelector(".order-width");
    const qInput = tr.querySelector(".order-qty");
    const delBtn = tr.querySelector(".btn-delete-row");

    const updateCalc = () => updateDemandCalculation();
    wInput.addEventListener("input", updateCalc);
    qInput.addEventListener("input", updateCalc);

    delBtn.addEventListener("click", () => {
      tr.remove();
      if (ordersTbody.children.length === 0) {
        createOrderRow();
      }
      updateDemandCalculation();
    });

    ordersTbody.appendChild(tr);
    updateDemandCalculation();
  }

  function updateDemandCalculation() {
    let totalMm = 0;
    const rows = ordersTbody.querySelectorAll("tr");
    rows.forEach((r) => {
      const w = parseInt(r.querySelector(".order-width").value, 10) || 0;
      const q = parseInt(r.querySelector(".order-qty").value, 10) || 0;
      if (w > 0 && q > 0) {
        totalMm += w * q;
      }
    });
    demandCounter.textContent = `Total Demand: ${totalMm.toLocaleString()} mm`;
  }

  /**
   * Adjust order-table row quantities by `delta` for each cut on a roll.
   * delta = -1  → deduct (roll marked as cut)
   * delta = +1  → restore (undo)
   * Rows whose qty reaches 0 are removed; missing widths are added as new rows.
   */
  function adjustOrderQty(cutsSummary, delta) {
    cutsSummary.forEach(({ width, quantity }) => {
      const change = delta * quantity;
      let matched = false;
      const rows = ordersTbody.querySelectorAll("tr");
      rows.forEach((r) => {
        const wInput = r.querySelector(".order-width");
        const qInput = r.querySelector(".order-qty");
        if (parseInt(wInput.value, 10) === width) {
          const newQty = (parseInt(qInput.value, 10) || 0) + change;
          if (newQty <= 0) {
            r.remove();
          } else {
            qInput.value = newQty;
          }
          matched = true;
        }
      });
      // Restore path: width may have been fully removed, re-add the row
      if (!matched && change > 0) {
        createOrderRow(width, change);
      }
    });
    if (ordersTbody.children.length === 0) createOrderRow();
    updateDemandCalculation();
  }

  btnAddOrderRow.addEventListener("click", () => createOrderRow());

  btnClearOrders.addEventListener("click", () => {
    ordersTbody.innerHTML = "";
    createOrderRow();
    updateDemandCalculation();
  });

  // --- CSV Import ---
  btnImportCsv.addEventListener("click", () => csvFileInput.click());

  csvFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/);
      ordersTbody.innerHTML = "";
      let count = 0;

      lines.forEach((line) => {
        const parts = line.split(",").map((s) => s.trim());
        if (parts.length >= 2) {
          const w = parseInt(parts[0], 10);
          const q = parseInt(parts[1], 10);
          if (w > 0 && q > 0) {
            createOrderRow(w, q);
            count++;
          }
        }
      });

      if (count === 0) {
        createOrderRow();
        showError("No valid rows found in CSV. Expected format: width,quantity per line.");
      } else {
        clearError();
      }
      csvFileInput.value = "";
    };
    reader.readAsText(file);
  });

  // --- Error Handling ---
  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = "block";
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.style.display = "none";
  }

  // --- Optimization Execution ---
  async function runOptimization(isReplan = false) {
    clearError();

    if (masterRolls.length === 0) {
      showError("Please specify at least one master roll width in the inventory.");
      return;
    }

    // Collect order demand from table
    const orderMap = new Map();
    const rows = ordersTbody.querySelectorAll("tr");
    rows.forEach((r) => {
      const w = parseInt(r.querySelector(".order-width").value, 10);
      const q = parseInt(r.querySelector(".order-qty").value, 10);
      if (w > 0 && q > 0) {
        orderMap.set(w, (orderMap.get(w) || 0) + q);
      }
    });

    if (orderMap.size === 0) {
      showError("Please enter at least one valid customer order (width and quantity).");
      return;
    }

    // Order table already reflects remaining demand (adjustOrderQty deducts on Mark-as-Cut).
    // No need to re-deduct here — just read the table directly.
    const orders = Array.from(orderMap.entries());

    if (orders.length === 0) {
      showError("All orders in the backlog have already been marked as cut/completed!");
      return;
    }

    // Validate against largest master roll (that still has stock)
    const availableRolls = masterRolls.filter((r) => r.qty === null || r.qty > 0);
    if (availableRolls.length === 0) {
      showError("All master roll stock has been exhausted! Please add more rolls to inventory.");
      return;
    }

    const maxMaster = Math.max(...availableRolls.map((r) => r.width));
    const oversized = orders.find((o) => o[0] > maxMaster);
    if (oversized) {
      showError(`Order item width (${oversized[0]}mm) exceeds largest available in-stock roll (${maxMaster}mm).`);
      return;
    }

    // Set Loading State
    const activeBtn = isReplan ? btnReoptimize : btnSolve;
    const originalText = isReplan ? "↻ Re-Plan Remaining" : "Calculate Cutting Plan";
    activeBtn.disabled = true;
    if (!isReplan) {
      btnSolveText.textContent = "Calculating Optimal Plan...";
      btnSpinner.style.display = "inline-block";
    }

    try {
      const response = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roll_widths: availableRolls.map((r) => ({ width: r.width, qty: r.qty })),
          orders: orders
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to calculate cutting plan.");
      }

      // ── Sync remaining qty for REMNANT rolls only ──
      // Regular master roll qty is managed by "Mark as Cut" clicks (–1 per cut).
      // Syncing regular rolls from remaining_inventory would zero them out before
      // they're physically cut, breaking the re-plan availability check.
      if (data.remaining_inventory && typeof data.remaining_inventory === "object") {
        const remaining = data.remaining_inventory;
        masterRolls.forEach((r) => {
          if (r.isRemnant && r.qty !== null && Object.prototype.hasOwnProperty.call(remaining, String(r.width))) {
            r.qty = remaining[String(r.width)];
          }
        });
      }

      if (!isReplan) {
        completedRollIds.clear();
        assignRollUids(data.plan);
        data.plan.forEach((r, idx) => { r.roll_num = idx + 1; });
        latestPlanData = data;
      } else {
        // Keep ONLY rolls that are actually marked as cut completed
        const completedRolls = (latestPlanData.plan || []).filter((r) => completedRollIds.has(r.uid));
        assignRollUids(data.plan);

        const combinedPlan = [...completedRolls, ...data.plan];
        // Cleanly renumber all rolls sequentially from 1 to N so no duplicate numbers exist!
        combinedPlan.forEach((r, idx) => { r.roll_num = idx + 1; });

        const combinedUsed = combinedPlan.reduce((acc, r) => acc + r.used_mm, 0);
        const combinedCapacity = combinedPlan.reduce((acc, r) => acc + r.roll_width, 0);
        const combinedWaste = combinedPlan.reduce((acc, r) => acc + r.waste_mm, 0);

        latestPlanData = {
          summary: {
            rolls_used: combinedPlan.length,
            total_demand_mm: combinedUsed,
            total_capacity_mm: combinedCapacity,
            total_used_mm: combinedUsed,
            total_waste_mm: combinedWaste,
            efficiency_pct: roundToTwo((combinedUsed / combinedCapacity) * 100)
          },
          plan: combinedPlan
        };
      }

      // Purge any remnants (isRemnant=true) whose stock has now reached 0
      // This runs for both fresh plans and re-plans.
      masterRolls = masterRolls.filter((r) => {
        if (r.isRemnant && r.qty !== null && r.qty <= 0) {
          remnantRollSizes.delete(r.width);
          return false; // fully consumed — remove from inventory chips
        }
        return true;
      });
      renderRollChips();

      renderPlanResults(latestPlanData);
    } catch (err) {
      showError(err.message);
    } finally {
      activeBtn.disabled = false;
      if (!isReplan) {
        btnSolveText.textContent = "Calculate Cutting Plan";
        btnSpinner.style.display = "none";
      }
    }
  }

  function roundToTwo(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  btnSolve.addEventListener("click", () => runOptimization(false));
  if (btnReoptimize) {
    btnReoptimize.addEventListener("click", () => runOptimization(true));
  }

  // --- Render Results ---
  function renderPlanResults(data) {
    const { summary, plan } = data;

    // 1. Populate KPI Bar
    kpiSection.style.display = "grid";
    kpiYield.textContent = `${summary.efficiency_pct}%`;
    kpiYieldSub.textContent = summary.efficiency_pct >= 99 ? "Exceptional Yield" : "Production Grade Yield";
    
    kpiRolls.textContent = `${summary.rolls_used} Rolls`;
    kpiCapacity.textContent = `Capacity: ${summary.total_capacity_mm.toLocaleString()} mm`;

    kpiDemand.textContent = `${summary.total_demand_mm.toLocaleString()} mm`;
    const totalCutsCount = plan.reduce((acc, r) => acc + r.segments.length, 0);
    kpiCutsCount.textContent = `${totalCutsCount} individual cuts`;

    kpiWaste.textContent = `${summary.total_waste_mm.toLocaleString()} mm`;
    const wastePct = (100 - summary.efficiency_pct).toFixed(2);
    kpiWastePct.textContent = `${wastePct}% total scrap`;

    // 2. Hide Empty State, Show Plan Cards
    emptyState.style.display = "none";
    planContainer.style.display = "flex";
    planContainer.innerHTML = "";
    
    const cutCount = plan.filter((r) => completedRollIds.has(r.uid)).length;
    planStatusNote.textContent = `${summary.rolls_used} master rolls planned (${cutCount} cut) • ${summary.efficiency_pct}% overall yield`;

    if (cutCount > 0 && btnReoptimize) {
      btnReoptimize.style.display = "inline-flex";
    }

    // 3. Render Each Roll Card
    plan.forEach((roll) => {
      const isCut = completedRollIds.has(roll.uid);
      const card = document.createElement("div");
      card.className = `roll-card ${isCut ? "completed-roll" : ""}`;

      let pillClass = "good";
      if (roll.waste_mm === 0) pillClass = "perfect";
      else if (roll.efficiency_pct < 80) pillClass = "scrap";

      // Render Visual Cutting Bar
      let segmentsHtml = "";
      roll.segments.forEach((seg) => {
        const color = getColorForWidth(seg.width);
        segmentsHtml += `
          <div class="cut-segment" 
               style="width: ${seg.pct_of_roll}%; background-color: ${color};" 
               title="Cut: ${seg.width}mm (${seg.pct_of_roll}% of roll)">
            ${seg.width}
          </div>
        `;
      });

      if (roll.waste_mm > 0) {
        segmentsHtml += `
          <div class="cut-segment waste-segment" 
               style="width: ${roll.waste_pct_of_roll}%;" 
               title="Waste scrap: ${roll.waste_mm}mm (${roll.waste_pct}%)">
            ${roll.waste_mm > 80 ? roll.waste_mm + "mm" : ""}
          </div>
        `;
      }

      // Manifest summary string
      const manifestItems = roll.cuts_summary.map((c) => `
        <span class="manifest-item"><strong>${c.width}mm</strong> &times; ${c.quantity}</span>
      `).join("");

      let remnantHtml = "";
      if (roll.waste_mm > 0) {
        remnantHtml = `
          <div class="roll-remnant-banner">
            <div class="remnant-desc">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <span>Leftover: <strong>${roll.waste_mm.toLocaleString()} mm</strong> (Uncut remnant)</span>
            </div>
            <button type="button" class="btn-remnant-action" data-width="${roll.waste_mm}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              <span>Use ${roll.waste_mm.toLocaleString()} mm for Next Batch</span>
            </button>
          </div>
        `;
      }

      const statusTagHtml = isCut
        ? `<span class="roll-status-tag completed">✓ Cut Completed</span>`
        : `<span class="roll-status-tag pending">Queued / Ready</span>`;

      const trials = roll.candidates_explored && roll.candidates_explored.length > 0
        ? roll.candidates_explored
        : [{
            pattern: roll.cuts_summary.map((c) => `${c.width}mm x ${c.quantity}`).join(", "),
            used_mm: roll.used_mm,
            waste_mm: roll.waste_mm,
            waste_pct: roll.waste_pct,
            efficiency_pct: roll.efficiency_pct,
            is_chosen: true
          }];

      const trialsRowsHtml = trials.map((t, idx) => `
        <tr class="${t.is_chosen ? 'trial-row-chosen' : ''}">
          <td>
            ${t.is_chosen 
              ? '<span class="trial-badge-chosen">✓ Best Chosen</span>' 
              : `<span class="trial-badge-alt">Trial #${idx + 1}</span>`}
          </td>
          <td>${t.pattern}</td>
          <td>${t.used_mm.toLocaleString()} mm</td>
          <td>${t.waste_mm.toLocaleString()} mm</td>
          <td><strong>${t.efficiency_pct}%</strong></td>
        </tr>
      `).join("");

      card.innerHTML = `
        <div class="roll-card-header">
          <div class="roll-identity">
            <span class="roll-title">Roll #${roll.roll_num}</span>
            <span class="roll-capacity-badge">${roll.roll_width.toLocaleString()} mm Roll</span>
            ${statusTagHtml}
          </div>
          <span class="yield-pill ${pillClass}">
            ${roll.waste_mm === 0 ? "100.0% Yield (0mm Waste)" : roll.efficiency_pct + "% Yield (" + roll.waste_mm + "mm Waste)"}
          </span>
        </div>

        <div class="visual-bar-container">
          <div class="roll-bar">
            ${segmentsHtml}
          </div>
        </div>

        <div class="roll-meta-row">
          <div class="manifest-list">
            ${manifestItems}
          </div>
          <div class="roll-stats-mini">
            Used: ${roll.used_mm.toLocaleString()} mm • Waste: ${roll.waste_mm} mm
          </div>
        </div>
        
        <div class="roll-operator-actions">
          <button type="button" class="btn-mark-cut ${isCut ? "is-cut" : ""}" data-roll-id="${roll.uid}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>${isCut ? "✓ Cut Completed (Click to Undo)" : "✓ Mark as Cut"}</span>
          </button>
          <button type="button" class="btn-report-reject" data-roll-id="${roll.uid}" title="Report a defective piece on this roll to re-cut it">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            Report Defect (+1)
          </button>
        </div>
        ${remnantHtml}

        <div class="roll-trials-toggle-row" style="margin-top: 6px;">
          <button type="button" class="btn-view-trials" title="Click to view all combinations the model evaluated before selecting this pattern">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>View Combinations Explored (${trials.length} trials)</span>
          </button>
        </div>

        <div class="trials-drawer">
          <div class="trials-header">
            <span>Model Evaluated Trials for Roll #${roll.roll_num} (${roll.roll_width.toLocaleString()} mm)</span>
            <span>${trials.length} candidate combinations generated</span>
          </div>
          <table class="trials-table">
            <thead>
              <tr>
                <th>Decision</th>
                <th>Cuts Combination</th>
                <th>Used</th>
                <th>Waste</th>
                <th>Yield</th>
              </tr>
            </thead>
            <tbody>
              ${trialsRowsHtml}
            </tbody>
          </table>
        </div>
      `;

      // Event listener: Toggle trials drawer
      const btnToggle = card.querySelector(".btn-view-trials");
      const drawer = card.querySelector(".trials-drawer");
      if (btnToggle && drawer) {
        btnToggle.addEventListener("click", () => {
          drawer.classList.toggle("open");
          const open = drawer.classList.contains("open");
          btnToggle.querySelector("span").textContent = open
            ? `Hide Combinations (${trials.length} trials)`
            : `View Combinations Explored (${trials.length} trials)`;
        });
      }

      // Event listener: Mark as Cut / Undo
      const btnCut = card.querySelector(".btn-mark-cut");
      btnCut.addEventListener("click", () => {
        const rollUid = roll.uid;
        const stockItem = masterRolls.find((r) => r.width === roll.roll_width);

        if (completedRollIds.has(rollUid)) {
          // ── Undo cut: restore master roll stock & add back demand ──
          completedRollIds.delete(rollUid);
          if (stockItem && stockItem.qty !== null) {
            stockItem.qty += 1;
          }
          adjustOrderQty(roll.cuts_summary, +1); // restore quantities to order table
        } else {
          // ── Mark cut: decrement master roll stock & deduct fulfilled demand ──
          completedRollIds.add(rollUid);
          if (stockItem && stockItem.qty !== null && stockItem.qty > 0) {
            stockItem.qty -= 1;
          }
          adjustOrderQty(roll.cuts_summary, -1); // deduct quantities from order table
          // Auto-carryover remnant ONLY if leftover >= 500mm (smaller scraps need manual queue)
          if (roll.waste_mm >= 500) {
            const existingRemnant = masterRolls.find((r) => r.width === roll.waste_mm);
            if (existingRemnant) {
              existingRemnant.qty = (existingRemnant.qty !== null ? existingRemnant.qty : 0) + 1;
            } else {
              masterRolls.push({ width: roll.waste_mm, qty: 1, isRemnant: true });
            }
          }
        }

        renderRollChips();
        renderPlanResults(latestPlanData);
      });

      // Event listener: Report Defect
      const btnReject = card.querySelector(".btn-report-reject");
      btnReject.addEventListener("click", () => {
        // Pick cut from this roll or default to first cut
        const availableCuts = roll.cuts_summary.map((c) => c.width);
        let selectedWidth = availableCuts[0];
        if (availableCuts.length > 1) {
          const promptMsg = `Select cut width with defect on Roll #${roll.roll_num}:\nAvailable: ${availableCuts.join(", ")} mm`;
          const input = prompt(promptMsg, String(selectedWidth));
          if (input && availableCuts.includes(parseInt(input.trim(), 10))) {
            selectedWidth = parseInt(input.trim(), 10);
          }
        }

        // Increment demand in table
        let found = false;
        const rows = ordersTbody.querySelectorAll("tr");
        rows.forEach((r) => {
          const w = parseInt(r.querySelector(".order-width").value, 10);
          if (w === selectedWidth) {
            const qInput = r.querySelector(".order-qty");
            qInput.value = (parseInt(qInput.value, 10) || 0) + 1;
            found = true;
          }
        });

        if (!found) {
          createOrderRow(selectedWidth, 1);
        }

        updateDemandCalculation();
        if (btnReoptimize) btnReoptimize.style.display = "inline-flex";
        showError(`Added 1x ${selectedWidth}mm reject back to demand backlog. Click "↻ Re-Plan Remaining" to schedule it.`);
      });

      // Remnant button click
      if (roll.waste_mm > 0) {
        const btnRemnant = card.querySelector(".btn-remnant-action");
        if (btnRemnant) {
          btnRemnant.addEventListener("click", () => {
            const w = roll.waste_mm;
            const existing = masterRolls.find((r) => r.width === w);
            if (existing) {
              masterRolls = masterRolls.filter((val) => val.width !== w);
              remnantRollSizes.delete(w);
            } else {
              masterRolls.push({ width: w, qty: 1, isRemnant: true });
              remnantRollSizes.add(w);
              clearError();
            }
            renderRollChips();
          });
        }
      }

      planContainer.appendChild(card);
    });

    syncRemnantButtons();
    // 4. Show Header Export Buttons
    btnExportImg.style.display = "inline-flex";
    btnPrint.style.display = "inline-flex";
    if (btnExportTrials) btnExportTrials.style.display = "inline-flex";
  }

  // --- Export Visual Cutting Design (PNG Image) ---
  function exportDesignAsImage() {
    if (!latestPlanData || !latestPlanData.plan || latestPlanData.plan.length === 0) return;

    const plan = latestPlanData.plan;
    const summary = latestPlanData.summary;

    const scale = 2; // High-res retina rendering
    const canvasWidth = 1120;
    const padding = 36;
    const headerHeight = 110;
    const cardHeight = 165;
    const cardGap = 16;
    const footerHeight = 45;
    const canvasHeight = headerHeight + (plan.length * (cardHeight + cardGap)) + footerHeight;

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth * scale;
    canvas.height = canvasHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Header Card
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding, canvasWidth - padding * 2, headerHeight - 16, 8, true, true);

    // Brand Title
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("RollCut OS — Production Cutting Layout", padding + 20, padding + 36);

    ctx.fillStyle = "#64748b";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    ctx.fillText(`Generated: ${dateStr}   |   Overall Material Yield: ${summary.efficiency_pct}%`, padding + 20, padding + 58);

    // Header KPI Badges on Right
    const kpiX = canvasWidth - padding - 20;
    ctx.textAlign = "right";
    ctx.fillStyle = "#0284c7";
    ctx.font = "bold 22px 'SF Mono', Consolas, Monaco, monospace";
    ctx.fillText(`${summary.efficiency_pct}%`, kpiX, padding + 38);
    ctx.fillStyle = "#64748b";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`${summary.rolls_used} Rolls  |  ${summary.total_demand_mm.toLocaleString()} mm cut`, kpiX, padding + 58);
    ctx.textAlign = "left";

    // Palette for cuts in canvas
    const colors = ["#0284c7", "#0d9488", "#7c3aed", "#d97706", "#2563eb", "#059669", "#dc2626", "#475569"];

    let y = padding + headerHeight + 6;

    plan.forEach((roll) => {
      // Roll Card Container
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e2e8f0";
      roundRect(ctx, padding, y, canvasWidth - padding * 2, cardHeight, 8, true, true);

      // Roll Title & Spec
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Roll #${roll.roll_num} — ${roll.roll_width.toLocaleString()} mm Master Roll`, padding + 18, y + 28);

      // Yield Pill
      ctx.textAlign = "right";
      const isZeroWaste = roll.waste_mm === 0;
      ctx.fillStyle = isZeroWaste ? "#059669" : "#0284c7";
      ctx.font = "bold 13px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(`${roll.efficiency_pct}% Yield (${roll.waste_mm}mm waste)`, canvasWidth - padding - 18, y + 28);
      ctx.textAlign = "left";

      // Visual Bar
      const barX = padding + 18;
      const barY = y + 42;
      const barW = canvasWidth - padding * 2 - 36;
      const barH = 46;

      ctx.save();
      roundRect(ctx, barX, barY, barW, barH, 5, false, false);
      ctx.clip();

      let currX = barX;
      roll.segments.forEach((seg, sIdx) => {
        const segW = (seg.pct_of_roll / 100) * barW;
        ctx.fillStyle = colors[sIdx % colors.length];
        ctx.fillRect(currX, barY, segW, barH);

        // Border between segments
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(currX, barY, segW, barH);

        // Segment text (if wide enough)
        if (segW > 28) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 11px 'SF Mono', Consolas, Monaco, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`${seg.width}`, currX + segW / 2, barY + 28);
          ctx.textAlign = "left";
        }

        currX += segW;
      });

      // Waste segment
      if (roll.waste_mm > 0) {
        const wasteW = barX + barW - currX;
        ctx.fillStyle = "#fee2e2";
        ctx.fillRect(currX, barY, wasteW, barH);

        if (wasteW > 35) {
          ctx.fillStyle = "#dc2626";
          ctx.font = "bold 10px 'SF Mono', Consolas, Monaco, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`${roll.waste_mm}mm`, currX + wasteW / 2, barY + 28);
          ctx.textAlign = "left";
        }
      }

      ctx.restore();

      // Bar Outline
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      roundRect(ctx, barX, barY, barW, barH, 5, false, true);

      // Cuts Summary Text Below Bar
      const summaryText = roll.cuts_summary.map((c) => `${c.width}mm × ${c.quantity}`).join("   |   ");
      ctx.fillStyle = "#334155";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Cuts: ${summaryText}`, barX, y + 115);

      ctx.fillStyle = "#64748b";
      ctx.font = "11px 'SF Mono', Consolas, Monaco, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`Used: ${roll.used_mm.toLocaleString()} mm   Waste: ${roll.waste_mm.toLocaleString()} mm`, canvasWidth - padding - 18, y + 115);
      ctx.textAlign = "left";

      y += cardHeight + cardGap;
    });

    // Footer
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("Exported from RollCut OS Industrial Slitter Optimization System", padding + 18, y + 22);

    // Trigger Download
    const link = document.createElement("a");
    link.download = `RollCut_Cutting_Plan_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Helper function to draw rounded rectangles on HTML5 canvas
  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === "number") {
      radius = { tl: radius, tr: radius, br: radius, bl: radius };
    }
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  btnExportImg.addEventListener("click", exportDesignAsImage);

  // --- Print Work Order ---
  btnPrint.addEventListener("click", () => {
    window.print();
  });

  // --- Export All Explored Trials as a Real Excel (.xlsx) Workbook ---
  function downloadExplorationSpreadsheet() {
    if (!latestPlanData || !latestPlanData.plan || latestPlanData.plan.length === 0) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `RollCut_All_Combination_Trials_${dateStr}.xlsx`;

    // 1. If SheetJS is loaded, create native Excel workbook with 2 separate sheets
    if (typeof XLSX !== "undefined") {
      const wb = XLSX.utils.book_new();

      // ── SHEET 1: PRODUCTION CUTTING PLAN ──
      const planData = [
        [
          "Roll Number",
          "Status",
          "Master Roll Width (mm)",
          "Cut Pattern Summary",
          "Total Cuts Count",
          "Used (mm)",
          "Waste (mm)",
          "Yield %"
        ]
      ];

      latestPlanData.plan.forEach((roll) => {
        const isCut = completedRollIds.has(roll.uid);
        const patternSummary = roll.cuts_summary
          .map((cut) => `${cut.width}mm x ${cut.quantity}`)
          .join(" | ");
        const totalCuts = roll.cuts_summary.reduce((sum, c) => sum + c.quantity, 0);

        planData.push([
          `Roll #${roll.roll_num}`,
          isCut ? "Cut Completed" : "Queued / Ready",
          roll.roll_width,
          patternSummary,
          totalCuts,
          roll.used_mm,
          roll.waste_mm,
          `${roll.efficiency_pct}%`
        ]);
      });

      const summary = latestPlanData.summary;
      const totalRolls = summary.rolls_used;
      const totalCapacity = summary.total_capacity_mm;
      const totalUsed = summary.total_demand_mm;
      const totalWaste = summary.total_waste_mm;
      const overallYield = summary.efficiency_pct;
      const totalCutsAll = latestPlanData.plan.reduce(
        (sum, r) => sum + r.cuts_summary.reduce((s, c) => s + c.quantity, 0),
        0
      );
      const cutCountAll = latestPlanData.plan.filter((r) => completedRollIds.has(r.uid)).length;

      planData.push([]);
      planData.push([
        "BATCH TOTALS",
        `${cutCountAll}/${totalRolls} Cut`,
        totalCapacity,
        `${totalRolls} Master Rolls`,
        totalCutsAll,
        totalUsed,
        totalWaste,
        `${overallYield}%`
      ]);

      const wsPlan = XLSX.utils.aoa_to_sheet(planData);
      wsPlan["!cols"] = [
        { wch: 14 },
        { wch: 16 },
        { wch: 22 },
        { wch: 45 },
        { wch: 16 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(wb, wsPlan, "Production Plan");

      // ── SHEET 2: ALL EXPLORED COMBINATION TRIALS ──
      const trialsData = [
        [
          "Roll Number",
          "Master Roll Width (mm)",
          "Decision Status",
          "Trial Rank",
          "Combination Pattern",
          "Total Cuts",
          "Used (mm)",
          "Waste (mm)",
          "Yield %",
          "Waste %",
          "Evaluation Category"
        ]
      ];

      latestPlanData.plan.forEach((roll) => {
        const trials = roll.candidates_explored && roll.candidates_explored.length > 0
          ? roll.candidates_explored
          : [{
              pattern: roll.cuts_summary.map((c) => `${c.width}mm x ${c.quantity}`).join(", "),
              used_mm: roll.used_mm,
              waste_mm: roll.waste_mm,
              waste_pct: roll.waste_pct,
              efficiency_pct: roll.efficiency_pct,
              is_chosen: true,
              cuts: roll.cuts_summary.reduce((acc, c) => ({ ...acc, [c.width]: c.quantity }), {})
            }];

        trials.forEach((trial, idx) => {
          const isChosen = trial.is_chosen;
          const totalCuts = trial.cuts ? Object.values(trial.cuts).reduce((sum, q) => sum + q, 0) : 0;
          let category = "Tier 1 (High Yield Cut)";
          if (trial.waste_mm === 0 || trial.waste_pct <= 0.001) {
            category = "Tier 0 (100% Zero-Waste)";
          } else if (trial.waste_mm >= 500) {
            category = "Tier 2 (Reusable Remnant >=500mm)";
          }

          trialsData.push([
            `Roll #${roll.roll_num}`,
            roll.roll_width,
            isChosen ? "✓ SELECTED (BEST COMBINATION)" : "Alternative Candidate Trial",
            idx + 1,
            trial.pattern,
            totalCuts,
            trial.used_mm,
            trial.waste_mm,
            `${trial.efficiency_pct}%`,
            `${trial.waste_pct}%`,
            category
          ]);
        });

        trialsData.push([]); // blank separator row between rolls
      });

      const wsTrials = XLSX.utils.aoa_to_sheet(trialsData);
      wsTrials["!cols"] = [
        { wch: 14 },
        { wch: 22 },
        { wch: 34 },
        { wch: 12 },
        { wch: 45 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 32 }
      ];
      XLSX.utils.book_append_sheet(wb, wsTrials, "Model Explored Trials");

      // Trigger instant native .xlsx file download
      XLSX.writeFile(wb, filename);
      return;
    }

    // 2. Offline Fallback: UTF-8 CSV with \uFEFF
    function formatCsvCell(val) {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes(";")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const rows = [];
    rows.push("=== SECTION 1: FINAL PRODUCTION CUTTING PLAN ===");
    rows.push([
      "Roll_Number", "Status", "Master_Roll_Width_mm", "Cut_Pattern_Summary",
      "Total_Cuts_Count", "Roll_Used_mm", "Roll_Waste_mm", "Roll_Yield_pct"
    ].join(","));

    latestPlanData.plan.forEach((roll) => {
      const isCut = completedRollIds.has(roll.uid);
      const patternSummary = roll.cuts_summary.map((c) => `${c.width}mm x ${c.quantity}`).join(" | ");
      const totalCuts = roll.cuts_summary.reduce((sum, c) => sum + c.quantity, 0);
      rows.push([
        roll.roll_num,
        isCut ? "Cut Completed" : "Queued / Ready",
        roll.roll_width,
        formatCsvCell(patternSummary),
        totalCuts,
        roll.used_mm,
        roll.waste_mm,
        roll.efficiency_pct
      ].join(","));
    });

    rows.push("");
    rows.push("=== SECTION 2: ALL COMBINATIONS & TRIALS EVALUATED FOR EACH ROLL ===");
    rows.push([
      "Roll_Number", "Master_Roll_Width_mm", "Decision_Status", "Trial_Rank",
      "Combination_Pattern", "Total_Cuts", "Used_mm", "Waste_mm",
      "Yield_pct", "Waste_pct", "Evaluation_Category"
    ].join(","));

    latestPlanData.plan.forEach((roll) => {
      const trials = roll.candidates_explored || [];
      trials.forEach((trial, idx) => {
        rows.push([
          `Roll #${roll.roll_num}`,
          roll.roll_width,
          trial.is_chosen ? "SELECTED (CHOSEN BEST COMBINATION)" : "Candidate Alternative Trial",
          idx + 1,
          formatCsvCell(trial.pattern),
          trial.cuts ? Object.values(trial.cuts).reduce((sum, q) => sum + q, 0) : 0,
          trial.used_mm,
          trial.waste_mm,
          trial.efficiency_pct + "%",
          trial.waste_pct + "%",
          trial.waste_mm === 0 ? "Tier 0 (100% Zero-Waste)" : "Tier 1"
        ].join(","));
      });
      rows.push("");
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(rows.join("\n"));
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `RollCut_Combinations_and_Trials_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (btnExportTrials) {
    btnExportTrials.addEventListener("click", downloadExplorationSpreadsheet);
  }

  // --- Initial Setup: Start completely fresh on page load / refresh ---
  try {
    localStorage.clear();
  } catch (e) {}

  createOrderRow();
  renderRollChips();
  updateDemandCalculation();
});
