/**
 * RollCut OS - Client-Side Controller
 * Supports 1D Width Slitting and 2D Width × Length Slitting & Sheeting
 */

document.addEventListener("DOMContentLoaded", () => {
  // ── Mode & State ──
  let currentMode = "1d"; // "1d" | "2d"

  // 1D State
  let masterRolls = []; // Array of { width: number, qty: number | null, isRemnant: boolean }
  const remnantRollSizes = new Set();
  let latestPlanData = null;
  let completedRollIds = new Set(); // Set of unique roll.uid strings marked as cut

  // 2D State
  let masterRolls2D = []; // Array of { width: number, length: number, qty: number | null, isRemnant: boolean }
  const remnantRollSizes2D = new Set();
  let latestPlanData2D = null;
  let completedRollIds2D = new Set();

  let ordersBackup1D = [];
  let ordersBackup2D = [];

  let originalOrdersSnapshot1D = [];
  let originalOrdersSnapshot2D = [];

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

  // DOM Elements - Navigation & Modes
  const btnMode1D = document.getElementById("btn-mode-1d");
  const btnMode2D = document.getElementById("btn-mode-2d");
  const brandSubtitle = document.getElementById("brand-subtitle");

  // DOM Elements - Master Roll Inventory
  const rollChipsContainer = document.getElementById("roll-chips-container");
  const rollPanelNote = document.getElementById("roll-panel-note");
  const rollFieldLabel = document.getElementById("roll-field-label");
  const inputNewRoll = document.getElementById("input-new-roll");
  const inputNewRollLen = document.getElementById("input-new-roll-len");
  const inputNewRollQty = document.getElementById("input-new-roll-qty");
  const btnAddRoll = document.getElementById("btn-add-roll");
  const btnClearRolls = document.getElementById("btn-clear-rolls");

  // DOM Elements - Customer Orders Table
  const orderPanelNote = document.getElementById("order-panel-note");
  const thOrderW = document.getElementById("th-order-w");
  const thOrderL = document.getElementById("th-order-l");
  const thOrderQ = document.getElementById("th-order-q");
  const ordersTbody = document.getElementById("orders-tbody");
  const btnAddOrderRow = document.getElementById("btn-add-order-row");
  const btnClearOrders = document.getElementById("btn-clear-orders");
  const btnImportCsv = document.getElementById("btn-import-csv");
  const csvFileInput = document.getElementById("csv-file-input");
  const demandCounter = document.getElementById("demand-counter");

  // DOM Elements - Action Controls
  const btnSolve = document.getElementById("btn-solve");
  const btnSolveText = document.getElementById("btn-solve-text");
  const btnReoptimize = document.getElementById("btn-reoptimize");
  const btnReoptimizeText = document.getElementById("btn-reoptimize-text");
  const btnReoptimizeSpinner = document.getElementById("btn-reoptimize-spinner");
  const btnSpinner = document.getElementById("btn-spinner");
  const errorMessage = document.getElementById("error-message");

  // DOM Elements - Operational KPIs
  const kpiSection = document.getElementById("kpi-section");
  const kpiYield = document.getElementById("kpi-yield");
  const kpiYieldSub = document.getElementById("kpi-yield-sub");
  const kpiRolls = document.getElementById("kpi-rolls");
  const kpiCapacity = document.getElementById("kpi-capacity");
  const kpiDemand = document.getElementById("kpi-demand");
  const kpiCutsCount = document.getElementById("kpi-cuts-count");
  const kpiWaste = document.getElementById("kpi-waste");
  const kpiWastePct = document.getElementById("kpi-waste-pct");

  // DOM Elements - Plan Outputs
  const emptyState = document.getElementById("empty-state");
  const planContainer = document.getElementById("plan-container");
  const planStatusNote = document.getElementById("plan-status-note");

  // DOM Elements - Exports
  const btnExportImg = document.getElementById("btn-export-img");
  const btnPrint = document.getElementById("btn-print");
  const btnExportTrials = document.getElementById("btn-export-trials");
  const exportOptionsBar = document.getElementById("export-options-bar");
  const chkIncTrials = document.getElementById("chk-inc-trials");
  const chkIncOrders = document.getElementById("chk-inc-orders");
  const chkIncScrap = document.getElementById("chk-inc-scrap");

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

  // ===================================================================
  // Mode Switching (1D vs 2D)
  // ===================================================================
  function setMode(mode) {
    if (mode === currentMode) return;
    clearError();

    // 1. Save current table inputs to backup
    if (currentMode === "1d") {
      ordersBackup1D = [];
      ordersTbody.querySelectorAll("tr").forEach((r) => {
        const w = r.querySelector(".order-width") ? r.querySelector(".order-width").value : "";
        const q = r.querySelector(".order-qty") ? r.querySelector(".order-qty").value : "";
        if (w || q) ordersBackup1D.push({ width: w, qty: q });
      });
    } else {
      ordersBackup2D = [];
      ordersTbody.querySelectorAll("tr").forEach((r) => {
        const w = r.querySelector(".order-width") ? r.querySelector(".order-width").value : "";
        const l = r.querySelector(".order-length") ? r.querySelector(".order-length").value : "";
        const q = r.querySelector(".order-qty") ? r.querySelector(".order-qty").value : "";
        if (w || l || q) ordersBackup2D.push({ width: w, length: l, qty: q });
      });
    }

    currentMode = mode;

    if (currentMode === "1d") {
      btnMode2D.classList.remove("active");
      btnMode2D.setAttribute("aria-selected", "false");
      btnMode1D.classList.add("active");
      btnMode1D.setAttribute("aria-selected", "true");

      if (brandSubtitle) brandSubtitle.innerHTML = "1D Cutting Stock Optimization Engine &bull; ML-Driven";
      if (rollPanelNote) rollPanelNote.textContent = "Available raw stock roll widths in warehouse";
      if (rollFieldLabel) rollFieldLabel.textContent = "Available Master Roll Sizes (mm)";
      inputNewRoll.placeholder = "Width in mm (e.g. 3000)";
      if (inputNewRollLen) inputNewRollLen.style.display = "none";
      if (inputNewRollQty) inputNewRollQty.placeholder = "Stock Qty (∞)";
      if (orderPanelNote) orderPanelNote.textContent = "Cut widths and required quantities";
      if (thOrderW) thOrderW.style.width = "50%";
      if (thOrderL) thOrderL.style.display = "none";
      if (thOrderQ) {
        thOrderQ.style.width = "35%";
        thOrderQ.textContent = "Quantity (pcs)";
      }

      // Restore 1D orders
      ordersTbody.innerHTML = "";
      if (ordersBackup1D.length > 0) {
        ordersBackup1D.forEach((item) => createOrderRow(item.width, item.qty));
      } else {
        createOrderRow();
      }

      renderRollChips();
      updateDemandCalculation();

      if (latestPlanData) {
        renderPlanResults(latestPlanData);
      } else {
        emptyState.style.display = "flex";
        planContainer.style.display = "none";
        kpiSection.style.display = "none";
        planStatusNote.textContent = "Awaiting calculation";
        btnExportImg.style.display = "none";
        btnPrint.style.display = "none";
        if (btnExportTrials) btnExportTrials.style.display = "none";
      }
    } else {
      // 2D Mode
      btnMode1D.classList.remove("active");
      btnMode1D.setAttribute("aria-selected", "false");
      btnMode2D.classList.add("active");
      btnMode2D.setAttribute("aria-selected", "true");

      if (brandSubtitle) brandSubtitle.innerHTML = "2D Cutting Stock Optimization Engine";
      if (rollPanelNote) rollPanelNote.textContent = "Available raw stock rolls (width in mm × length in meters) in warehouse";
      if (rollFieldLabel) rollFieldLabel.textContent = "Available Master Roll Sizes (Width mm × Length m)";
      inputNewRoll.placeholder = "Width (mm)";
      if (inputNewRollLen) {
        inputNewRollLen.style.display = "block";
        inputNewRollLen.placeholder = "Length (m)";
      }
      if (inputNewRollQty) inputNewRollQty.placeholder = "Stock (∞)";
      if (orderPanelNote) orderPanelNote.textContent = "Cut sizes (width in mm × length in meters) and roll quantities";
      if (thOrderW) thOrderW.style.width = "32%";
      if (thOrderL) {
        thOrderL.style.display = "";
        thOrderL.style.width = "32%";
        thOrderL.textContent = "Length (m)";
      }
      if (thOrderQ) {
        thOrderQ.style.width = "22%";
        thOrderQ.textContent = "Quantity (rolls)";
      }

      // Restore 2D orders
      ordersTbody.innerHTML = "";
      if (ordersBackup2D.length > 0) {
        ordersBackup2D.forEach((item) => createOrderRow(item.width, item.qty, item.length));
      } else {
        createOrderRow("", "", "");
      }

      renderRollChips();
      updateDemandCalculation();

      if (latestPlanData2D) {
        renderPlanResults2D(latestPlanData2D);
      } else {
        emptyState.style.display = "flex";
        planContainer.style.display = "none";
        kpiSection.style.display = "none";
        planStatusNote.textContent = "Awaiting calculation";
        btnExportImg.style.display = "none";
        btnPrint.style.display = "none";
        if (btnExportTrials) btnExportTrials.style.display = "none";
        if (exportOptionsBar) exportOptionsBar.style.display = "none";
      }
    }
  }

  if (btnMode1D) btnMode1D.addEventListener("click", () => setMode("1d"));
  if (btnMode2D) btnMode2D.addEventListener("click", () => setMode("2d"));

  // ===================================================================
  // Master Roll Inventory Management
  // ===================================================================
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

  function syncRemnantButtons2D() {
    document.querySelectorAll(".btn-remnant-2d").forEach((btn) => {
      const w = parseInt(btn.getAttribute("data-w"), 10);
      const l = parseInt(btn.getAttribute("data-l"), 10);
      const sourceUid = btn.getAttribute("data-source-uid");
      const exists = masterRolls2D.some((r) => {
        if (sourceUid && r.sourceRollUid) {
          return r.sourceRollUid === sourceUid && r.width === w && r.length === l;
        }
        return r.width === w && r.length === l;
      });
      if (exists) {
        btn.classList.add("btn-remnant-added");
        btn.innerHTML = `✓ Queued in Stock (${w.toLocaleString()} mm &times; ${l.toLocaleString()} m)`;
      } else {
        btn.classList.remove("btn-remnant-added");
        btn.innerHTML = `+ Add Remnant to Stock (${w.toLocaleString()} mm × ${l.toLocaleString()} m)`;
      }
    });
  }

  function cleanupUncutRemnants1D() {
    if (!latestPlanData || !latestPlanData.plan) return;
    const uncutRolls = latestPlanData.plan.filter((r) => !completedRollIds.has(r.uid));
    if (uncutRolls.length === 0) return;

    const uncutUids = new Set(uncutRolls.map((r) => r.uid));

    masterRolls = masterRolls.filter((rem) => {
      if (!rem.isRemnant) return true;

      if (rem.sourceRollUid && uncutUids.has(rem.sourceRollUid)) {
        remnantRollSizes.delete(rem.width);
        return false;
      }

      const isUncut = uncutRolls.some((ur) => rem.width === ur.waste_mm);
      if (isUncut && (!rem.sourceRollUid || uncutUids.has(rem.sourceRollUid))) {
        remnantRollSizes.delete(rem.width);
        return false;
      }

      return true;
    });
  }

  function cleanupUncutRemnants2D() {
    if (!latestPlanData2D || !latestPlanData2D.plan) return;
    const uncutRolls = latestPlanData2D.plan.filter((r) => !completedRollIds2D.has(r.uid));
    if (uncutRolls.length === 0) return;

    const uncutUids = new Set(uncutRolls.map((r) => r.uid));

    masterRolls2D = masterRolls2D.filter((rem) => {
      if (!rem.isRemnant) return true;

      // Only clean up remnants that came from an uncut roll that is being re-planned
      if (rem.sourceRollUid && uncutUids.has(rem.sourceRollUid)) {
        remnantRollSizes2D.delete(`${rem.width}_${rem.length}`);
        return false;
      }

      return true;
    });
  }

  function renderRollChips() {
    rollChipsContainer.innerHTML = "";

    if (currentMode === "1d") {
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
    } else {
      // 2D Chips
      if (masterRolls2D.length === 0) {
        const emptyHint = document.createElement("span");
        emptyHint.className = "empty-chips-hint";
        emptyHint.textContent = "No 2D master rolls added yet. Please enter roll width (mm) and length (m) below.";
        rollChipsContainer.appendChild(emptyHint);
        syncRemnantButtons2D();
        return;
      }
      masterRolls2D.sort((a, b) => (b.width * b.length) - (a.width * a.length));
      masterRolls2D.forEach((item, idx) => {
        const chipKey = `${item.width}_${item.length}`;
        const isRemnant = item.isRemnant || remnantRollSizes2D.has(chipKey);
        const chip = document.createElement("div");
        chip.className = `chip ${isRemnant ? "chip-remnant" : ""}`;
        const stockStr = item.qty === null ? "∞ stock" : `${item.qty} in stock`;
        const stockZeroClass = item.qty !== null && item.qty <= 0 ? "chip-stock-zero" : "";
        chip.innerHTML = `
          <span>${item.width.toLocaleString()} mm &times; ${item.length.toLocaleString()} m</span>
          <span class="chip-stock ${stockZeroClass}">${stockStr}</span>
          ${isRemnant ? '<span class="chip-badge-remnant">Leftover</span>' : ''}
          <span class="chip-remove" title="Remove size">&times;</span>
        `;
        chip.querySelector(".chip-remove").addEventListener("click", () => {
          masterRolls2D.splice(idx, 1);
          remnantRollSizes2D.delete(chipKey);
          renderRollChips();
        });
        rollChipsContainer.appendChild(chip);
      });
      syncRemnantButtons2D();
    }
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

    if (currentMode === "1d") {
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
    } else {
      // 2D Mode
      const lenVal = inputNewRollLen ? parseInt(inputNewRollLen.value.trim(), 10) : 0;
      if (!lenVal || lenVal <= 0) {
        showError("Please enter a valid positive roll length in meters (m).");
        return;
      }
      const existing = masterRolls2D.find((r) => r.width === val && r.length === lenVal);
      if (existing) {
        if (qtyVal !== null) {
          existing.qty = (existing.qty !== null ? existing.qty : 0) + qtyVal;
        } else {
          existing.qty = null;
        }
      } else {
        masterRolls2D.push({ width: val, length: lenVal, qty: qtyVal, isRemnant: false });
      }
      if (inputNewRollLen) inputNewRollLen.value = "";
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
  if (inputNewRollLen) {
    inputNewRollLen.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addRollSize();
      }
    });
  }
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
      if (currentMode === "1d") {
        masterRolls = [];
        remnantRollSizes.clear();
      } else {
        masterRolls2D = [];
        remnantRollSizes2D.clear();
      }
      renderRollChips();
    });
  }

  // ===================================================================
  // Order Table Management
  // ===================================================================
  function createOrderRow(width = "", qty = "", length = "") {
    const tr = document.createElement("tr");

    if (currentMode === "1d") {
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
    } else {
      tr.innerHTML = `
        <td>
          <input type="number" class="order-width" placeholder="Width (mm)" value="${width}" min="1" step="1">
        </td>
        <td class="td-order-len">
          <input type="number" class="order-length" placeholder="Length (m)" value="${length}" min="1" step="1">
        </td>
        <td>
          <input type="number" class="order-qty" placeholder="Qty (rolls)" value="${qty}" min="1" step="1">
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn btn-text danger btn-sm btn-delete-row" title="Delete line">&times;</button>
        </td>
      `;
    }

    const wInput = tr.querySelector(".order-width");
    const lInput = tr.querySelector(".order-length");
    const qInput = tr.querySelector(".order-qty");
    const delBtn = tr.querySelector(".btn-delete-row");

    const updateCalc = () => updateDemandCalculation();
    if (wInput) wInput.addEventListener("input", updateCalc);
    if (lInput) lInput.addEventListener("input", updateCalc);
    if (qInput) qInput.addEventListener("input", updateCalc);

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
    if (currentMode === "1d") {
      let totalMm = 0;
      const rows = ordersTbody.querySelectorAll("tr");
      rows.forEach((r) => {
        const wInput = r.querySelector(".order-width");
        const qInput = r.querySelector(".order-qty");
        const w = wInput ? parseInt(wInput.value, 10) || 0 : 0;
        const q = qInput ? parseInt(qInput.value, 10) || 0 : 0;
        if (w > 0 && q > 0) {
          totalMm += w * q;
        }
      });
      demandCounter.textContent = `Total Demand: ${totalMm.toLocaleString()} mm`;
    } else {
      let totalArea = 0;
      let totalRolls = 0;
      const rows = ordersTbody.querySelectorAll("tr");
      rows.forEach((r) => {
        const wInput = r.querySelector(".order-width");
        const lInput = r.querySelector(".order-length");
        const qInput = r.querySelector(".order-qty");
        const w = wInput ? parseInt(wInput.value, 10) || 0 : 0;
        const l = lInput ? parseInt(lInput.value, 10) || 0 : 0;
        const q = qInput ? parseInt(qInput.value, 10) || 0 : 0;
        if (w > 0 && l > 0 && q > 0) {
          totalArea += (w * l * q);
          totalRolls += q;
        }
      });
      const areaM2 = (totalArea / 1000).toFixed(2);
      demandCounter.textContent = `Total Demand: ${areaM2} m² (${totalRolls} rolls)`;
    }
  }

  /**
   * Adjust order-table row quantities by `delta` for each cut on a roll.
   * delta = -1  → deduct (roll marked as cut)
   * delta = +1  → restore (undo)
   */
  function adjustOrderQty(cutsSummary, delta) {
    cutsSummary.forEach(({ width, quantity, length }) => {
      const change = delta * quantity;
      let matched = false;
      const rows = ordersTbody.querySelectorAll("tr");
      rows.forEach((r) => {
        const wInput = r.querySelector(".order-width");
        const qInput = r.querySelector(".order-qty");
        const lInput = r.querySelector(".order-length");

        const rowW = parseInt(wInput.value, 10);
        const rowL = lInput ? parseInt(lInput.value, 10) : null;

        const isMatch = currentMode === "1d"
          ? (rowW === width)
          : (rowW === width && (!length || rowL === length));

        if (isMatch) {
          const newQty = (parseInt(qInput.value, 10) || 0) + change;
          if (newQty <= 0) {
            r.remove();
          } else {
            qInput.value = newQty;
          }
          matched = true;
        }
      });

      // Restore path: size may have been fully removed, re-add the row
      if (!matched && change > 0) {
        createOrderRow(width, change, length || "");
      }
    });
    if (ordersTbody.children.length === 0) createOrderRow();
    updateDemandCalculation();
  }

  btnAddOrderRow.addEventListener("click", () => createOrderRow());

  btnClearOrders.addEventListener("click", () => {
    ordersTbody.innerHTML = "";
    if (currentMode === "1d") originalOrdersSnapshot1D = [];
    else originalOrdersSnapshot2D = [];
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
        if (currentMode === "1d") {
          if (parts.length >= 2) {
            const w = parseInt(parts[0], 10);
            const q = parseInt(parts[1], 10);
            if (w > 0 && q > 0) {
              createOrderRow(w, q);
              count++;
            }
          }
        } else {
          // 2D mode: width, length, quantity
          if (parts.length >= 3) {
            const w = parseInt(parts[0], 10);
            const l = parseInt(parts[1], 10);
            const q = parseInt(parts[2], 10);
            if (w > 0 && l > 0 && q > 0) {
              createOrderRow(w, q, l);
              count++;
            }
          } else if (parts.length === 2) {
            // fallback: width, quantity (defaults length to 1000)
            const w = parseInt(parts[0], 10);
            const q = parseInt(parts[1], 10);
            if (w > 0 && q > 0) {
              createOrderRow(w, q, 1000);
              count++;
            }
          }
        }
      });

      if (count === 0) {
        createOrderRow();
        const fmtHint = currentMode === "1d" ? "width,quantity" : "width,length,quantity";
        showError(`No valid rows found in CSV. Expected format: ${fmtHint} per line.`);
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
    try {
      errorMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) { }
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.style.display = "none";
  }

  function roundToTwo(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  // ===================================================================
  // Optimization Dispatcher
  // ===================================================================
  async function runOptimization(isReplan = false) {
    clearError();
    if (currentMode === "1d") {
      await runOptimization1D(isReplan);
    } else {
      await runOptimization2D(isReplan);
    }
  }

  btnSolve.addEventListener("click", () => runOptimization(false));
  if (btnReoptimize) {
    btnReoptimize.addEventListener("click", () => runOptimization(true));
  }

  // ===================================================================
  // 1D Optimization & Rendering (Unchanged)
  // ===================================================================
  async function runOptimization1D(isReplan = false) {
    cleanupUncutRemnants1D();
    renderRollChips();

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

    const orders = Array.from(orderMap.entries());
    if (orders.length === 0) {
      showError("All orders in the backlog have already been marked as cut/completed!");
      return;
    }

    if (!isReplan || originalOrdersSnapshot1D.length === 0) {
      originalOrdersSnapshot1D = orders.map(([w, q]) => ({ width: w, quantity: q }));
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
    activeBtn.disabled = true;
    if (isReplan) {
      if (btnReoptimizeText) btnReoptimizeText.textContent = "↻ Re-Planning...";
      if (btnReoptimizeSpinner) btnReoptimizeSpinner.style.display = "inline-block";
    } else {
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

      // Sync remaining qty for REMNANT rolls only
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
        const completedRolls = (latestPlanData.plan || []).filter((r) => completedRollIds.has(r.uid));
        assignRollUids(data.plan);

        const combinedPlan = [...completedRolls, ...data.plan];
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

      masterRolls = masterRolls.filter((r) => {
        if (r.isRemnant && r.qty !== null && r.qty <= 0) {
          remnantRollSizes.delete(r.width);
          return false;
        }
        return true;
      });

      if (latestPlanData && latestPlanData.plan) {
        latestPlanData.plan.forEach((roll) => {
          if (roll.waste_mm === 0) {
            masterRolls = masterRolls.filter((rem) => {
              if (rem.isRemnant && (rem.sourceRollUid === roll.uid || !rem.sourceRollUid)) {
                remnantRollSizes.delete(rem.width);
                return false;
              }
              return true;
            });
          }
        });
      }
      renderRollChips();

      renderPlanResults(latestPlanData);
    } catch (err) {
      showError(err.message);
    } finally {
      activeBtn.disabled = false;
      if (isReplan) {
        if (btnReoptimizeText) btnReoptimizeText.textContent = "↻ Re-Plan Remaining";
        if (btnReoptimizeSpinner) btnReoptimizeSpinner.style.display = "none";
      } else {
        btnSolveText.textContent = "Calculate Cutting Plan";
        btnSpinner.style.display = "none";
      }
    }
  }

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
          completedRollIds.delete(rollUid);
          if (stockItem && stockItem.qty !== null) {
            stockItem.qty += 1;
          }
          adjustOrderQty(roll.cuts_summary, +1);
        } else {
          completedRollIds.add(rollUid);
          if (stockItem && stockItem.qty !== null && stockItem.qty > 0) {
            stockItem.qty -= 1;
          }
          adjustOrderQty(roll.cuts_summary, -1);
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
        const availableCuts = roll.cuts_summary.map((c) => c.width);
        let selectedWidth = availableCuts[0];
        if (availableCuts.length > 1) {
          const promptMsg = `Select cut width with defect on Roll #${roll.roll_num}:\nAvailable: ${availableCuts.join(", ")} mm`;
          const input = prompt(promptMsg, String(selectedWidth));
          if (input && availableCuts.includes(parseInt(input.trim(), 10))) {
            selectedWidth = parseInt(input.trim(), 10);
          }
        }

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
              masterRolls.push({ width: w, qty: 1, isRemnant: true, sourceRollUid: roll.uid });
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
    btnExportImg.style.display = "inline-flex";
    btnPrint.style.display = "inline-flex";
    if (btnExportTrials) btnExportTrials.style.display = "inline-flex";
    if (exportOptionsBar) exportOptionsBar.style.display = "flex";
  }

  // ===================================================================
  // 2D Optimization & Rendering
  // ===================================================================
  async function runOptimization2D(isReplan = false) {
    cleanupUncutRemnants2D();
    renderRollChips();

    if (masterRolls2D.length === 0) {
      showError("Please specify at least one 2D master roll (width and length) in the inventory.");
      return;
    }

    const availableRolls = masterRolls2D.filter((r) => r.qty === null || r.qty > 0);
    if (availableRolls.length === 0) {
      showError("All 2D master roll stock has been exhausted! Please add more rolls to inventory.");
      return;
    }

    // Collect 2D orders from table
    const orderList = [];
    const rows = ordersTbody.querySelectorAll("tr");
    rows.forEach((r) => {
      const wInput = r.querySelector(".order-width");
      const lInput = r.querySelector(".order-length");
      const qInput = r.querySelector(".order-qty");
      const w = wInput ? parseInt(wInput.value, 10) : 0;
      const l = lInput ? parseInt(lInput.value, 10) : 0;
      const q = qInput ? parseInt(qInput.value, 10) : 0;
      if (w > 0 && l > 0 && q > 0) {
        orderList.push({ width: w, length: l, quantity: q });
      }
    });

    if (orderList.length === 0) {
      if (completedRollIds2D.size > 0) {
        showError("All customer orders are already cut and completed! To plan additional rolls, add new items in the Customer Demand table on the left, then click '↻ Re-Plan Remaining'.");
      } else {
        showError("Please enter at least one valid customer order with positive width, length, and quantity.");
      }
      return;
    }

    if (!isReplan || originalOrdersSnapshot2D.length === 0) {
      originalOrdersSnapshot2D = JSON.parse(JSON.stringify(orderList));
    }

    const maxW = Math.max(...availableRolls.map((r) => r.width));
    const maxL = Math.max(...availableRolls.map((r) => r.length));
    const overW = orderList.find((o) => o.width > maxW);
    if (overW) {
      showError(`Order item width (${overW.width}mm) exceeds largest available master roll width (${maxW}mm).`);
      return;
    }
    const overL = orderList.find((o) => o.length > maxL);
    if (overL) {
      showError(`Order item length (${overL.length}m) exceeds largest available master roll length (${maxL}m).`);
      return;
    }

    const activeBtn = (isReplan && btnReoptimize) ? btnReoptimize : btnSolve;
    activeBtn.disabled = true;
    if (isReplan) {
      if (btnReoptimizeText) btnReoptimizeText.textContent = "↻ Re-Planning...";
      if (btnReoptimizeSpinner) btnReoptimizeSpinner.style.display = "inline-block";
    } else {
      btnSolveText.textContent = "Calculating Optimal 2D Plan...";
      btnSpinner.style.display = "inline-block";
    }

    try {
      const response = await fetch("/api/optimize-2d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          master_rolls: availableRolls.map((r) => ({ width: r.width, length: r.length, qty: r.qty, isRemnant: !!r.isRemnant })),
          orders: orderList
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to calculate 2D cutting plan.");
      }

      // Sync remaining qty for 2D REMNANT rolls
      if (data.remaining_inventory && typeof data.remaining_inventory === "object") {
        const remaining = data.remaining_inventory;
        masterRolls2D.forEach((r) => {
          const key = `${r.width}_${r.length}`;
          if (r.isRemnant && r.qty !== null && Object.prototype.hasOwnProperty.call(remaining, key)) {
            r.qty = remaining[key];
          }
        });
        masterRolls2D = masterRolls2D.filter((r) => {
          if (r.isRemnant && r.qty !== null && r.qty <= 0) {
            remnantRollSizes2D.delete(`${r.width}_${r.length}`);
            return false;
          }
          return true;
        });
      }

      // Check if any rolls are marked as cut (final)
      const completedRolls = (latestPlanData2D && latestPlanData2D.plan)
        ? latestPlanData2D.plan.filter((r) => completedRollIds2D.has(r.uid))
        : [];

      if (completedRolls.length > 0 || isReplan) {
        assignRollUids(data.plan);
        const combinedPlan = [...completedRolls, ...data.plan];
        combinedPlan.forEach((r, idx) => { r.roll_num = idx + 1; });

        const totalCutArea = combinedPlan.reduce((acc, r) => acc + (r.total_used_area || 0), 0);
        const totalAllocArea = combinedPlan.reduce((acc, r) => acc + (r.roll_area || 0), 0);
        const totalSlitArea = combinedPlan.reduce((acc, r) => acc + (r.master_width * r.length_used), 0);
        const totalTrimWaste = combinedPlan.reduce((acc, r) => acc + (r.section_waste_area || 0), 0);
        const totalLengthRem = combinedPlan.reduce((acc, r) => acc + (r.remnant_area || 0), 0);
        const totalWidthRem = combinedPlan.reduce((acc, r) => acc + (r.total_width_remnant_area || 0), 0);
        const totalReusable = totalLengthRem + totalWidthRem;
        const netScrap = Math.max(0, combinedPlan.reduce((acc, r) => acc + (r.total_waste_area || 0), 0) - totalReusable);

        latestPlanData2D = {
          summary: {
            rolls_used: combinedPlan.length,
            total_product_cut_area: totalCutArea,
            total_roll_area_allocated: totalAllocArea,
            total_slitting_trim_waste: totalTrimWaste,
            total_reusable_remnant: totalReusable,
            total_length_remnant: totalLengthRem,
            total_width_remnant: totalWidthRem,
            net_scrap_area: netScrap,
            net_scrap_pct: roundToTwo((netScrap / (totalAllocArea || 1)) * 100),
            slitting_efficiency_pct: totalSlitArea ? roundToTwo((totalCutArea / totalSlitArea) * 100) : 0,
            overall_roll_utilization_pct: totalAllocArea ? roundToTwo((totalCutArea / totalAllocArea) * 100) : 0,
          },
          plan: combinedPlan
        };
      } else {
        completedRollIds2D.clear();
        assignRollUids(data.plan);
        data.plan.forEach((r, idx) => { r.roll_num = idx + 1; });
        latestPlanData2D = data;
      }

      if (latestPlanData2D && latestPlanData2D.plan) {
        latestPlanData2D.plan.forEach((roll) => {
          if (roll.remnant_length < 10 || roll.length_used >= roll.master_length) {
            masterRolls2D = masterRolls2D.filter((rem) => {
              if (rem.isRemnant && rem.width === roll.master_width && rem.sourceRollUid && rem.sourceRollUid === roll.uid) {
                remnantRollSizes2D.delete(`${rem.width}_${rem.length}`);
                return false;
              }
              return true;
            });
          }
        });
      }
      renderRollChips();

      renderPlanResults2D(latestPlanData2D);
    } catch (err) {
      showError(err.message);
    } finally {
      activeBtn.disabled = false;
      if (isReplan) {
        if (btnReoptimizeText) btnReoptimizeText.textContent = "↻ Re-Plan Remaining";
        if (btnReoptimizeSpinner) btnReoptimizeSpinner.style.display = "none";
      } else {
        btnSolveText.textContent = "Calculate Cutting Plan";
        btnSpinner.style.display = "none";
      }
    }
  }

  function renderPlanResults2D(data) {
    const { summary, plan } = data;

    // 1. Populate KPI Bar
    kpiSection.style.display = "grid";
    kpiYield.textContent = `${summary.slitting_efficiency_pct}%`;
    kpiYieldSub.textContent = "Slitting run efficiency";

    kpiRolls.textContent = `${summary.rolls_used} Rolls`;
    const allocAreaM2 = (summary.total_roll_area_allocated / 1000).toFixed(2);
    kpiCapacity.textContent = `Allocated: ${allocAreaM2} m²`;

    const cutAreaM2 = (summary.total_product_cut_area / 1000).toFixed(2);
    kpiDemand.textContent = `${cutAreaM2} m²`;
    let totalPieces = 0;
    plan.forEach((r) => {
      r.sections.forEach((s) => {
        s.cuts.forEach((c) => { totalPieces += c.quantity; });
      });
    });
    kpiCutsCount.textContent = `${totalPieces} rolls cut`;

    const netScrapM2 = ((summary.net_scrap_area !== undefined ? summary.net_scrap_area : 0) / 1000).toFixed(2);
    const totalRemM2 = ((summary.total_reusable_remnant || 0) / 1000).toFixed(2);
    const widthRemM2 = ((summary.total_width_remnant || 0) / 1000).toFixed(2);
    const lengthRemM2 = ((summary.total_length_remnant || 0) / 1000).toFixed(2);
    const scrapPct = summary.net_scrap_pct !== undefined
      ? summary.net_scrap_pct
      : ((summary.net_scrap_area / (summary.total_roll_area_allocated || 1)) * 100).toFixed(2);

    kpiWaste.textContent = `${netScrapM2} m² net scrap`;
    if (parseFloat(totalRemM2) > 0) {
      kpiWastePct.textContent = `${scrapPct}% true scrap • ${totalRemM2} m² saved to stock`;
    } else {
      kpiWastePct.textContent = `${scrapPct}% true scrap`;
    }

    // 2. Hide Empty State, Show Plan Cards
    emptyState.style.display = "none";
    planContainer.style.display = "flex";
    planContainer.innerHTML = "";

    const cutCount = plan.filter((r) => completedRollIds2D.has(r.uid)).length;
    planStatusNote.textContent = `${summary.rolls_used} 2D master rolls planned (${cutCount} cut) • ${summary.slitting_efficiency_pct}% slitting efficiency`;

    if (btnReoptimize) {
      btnReoptimize.style.display = (completedRollIds2D.size > 0) ? "inline-flex" : "none";
    }

    // 3. Render Each 2D Roll Card
    plan.forEach((roll) => {
      const isCut = completedRollIds2D.has(roll.uid);
      const card = document.createElement("div");
      card.className = `roll-card-2d ${isCut ? "completed-roll" : ""}`;

      let pillClass = "good";
      if (roll.slitting_eff_pct >= 99) pillClass = "perfect";
      else if (roll.slitting_eff_pct < 80) pillClass = "scrap";

      const statusTagHtml = isCut
        ? `<span class="roll-status-tag completed">✓ Cut Completed</span>`
        : `<span class="roll-status-tag pending">Queued / Ready</span>`;

      const pctUsed = Math.min(100, Math.round((roll.length_used / roll.master_length) * 100));
      const pctRemnant = Math.max(0, 100 - pctUsed);

      // Render Sections (Slitting Runs)
      let sectionsHtml = "";
      roll.sections.forEach((sec, sIdx) => {
        let lanesHtml = "";
        sec.cuts.forEach((cut) => {
          const color = getColorForWidth(cut.width);
          for (let p = 0; p < cut.quantity; p++) {
            const wPct = ((cut.width / roll.master_width) * 100).toFixed(2);
            lanesHtml += `
              <div class="slitting-lane" style="width: ${wPct}%; background-color: ${color};" title="Cut: ${cut.width}mm x ${cut.length}m (${wPct}% of width)">
                ${cut.width}
              </div>
            `;
          }
        });

        const isWidthRem = sec.is_width_remnant || sec.width_waste_mm >= 150;
        if (sec.width_waste_mm > 0) {
          const wastePct = ((sec.width_waste_mm / roll.master_width) * 100).toFixed(2);
          const laneClass = isWidthRem ? "trim-waste-segment is-width-remnant" : "trim-waste-segment";
          const laneTitle = isWidthRem
            ? `Side Offcut: ${sec.width_waste_mm}mm (${wastePct}%)`
            : `Edge Trim Scrap: ${sec.width_waste_mm}mm (${wastePct}%)`;
          const label = isWidthRem
            ? `${sec.width_waste_mm}mm offcut`
            : (sec.width_waste_mm > 60 ? `${sec.width_waste_mm}mm trim` : "");
          lanesHtml += `
            <div class="${laneClass}" style="width: ${wastePct}%;" title="${laneTitle}">
              ${label}
            </div>
          `;
        }

        const cutsSummaryList = sec.cuts.map((c) => `
          <span class="section-manifest-item">
            <strong>${c.width}mm &times; ${c.length}m</strong> &times; ${c.quantity} rolls
          </span>
        `).join("");

        sectionsHtml += `
          <div class="section-card-2d">
            <div class="section-header-2d">
              <div class="section-title">
                <span class="section-badge">Run #${sIdx + 1}</span>
                <span>Length: <strong>${sec.section_length.toLocaleString()} m</strong></span>
              </div>
              <div class="section-stats-inline">
                Width: ${sec.used_width_mm.toLocaleString()} / ${roll.master_width.toLocaleString()} mm 
                &bull; Trim: <span style="color: ${isWidthRem ? 'var(--accent-primary, #2563eb)' : 'var(--accent-danger)'}; font-weight: 600;">${sec.width_waste_mm} mm (${sec.waste_area_pct}%)</span>
              </div>
            </div>
            <div class="slitting-bar-2d">
              ${lanesHtml}
            </div>
            <div class="section-manifest-2d">
              ${cutsSummaryList}
            </div>
          </div>
        `;
      });

      // Consolidated Roll Remnant Banner (At most ONE clean banner per roll)
      let remnantBannerHtml = "";
      const hasLengthRem = roll.remnant_length >= 10; // >= 10m uncut master roll remnant

      // Look for a major reusable side offcut across the roll (>= 150mm width, >= 10m length, >= 1.0m2)
      let majorWidthRem = null;
      let maxOffcutArea = 0;
      roll.sections.forEach((sec) => {
        if (sec.width_waste_mm >= 150 && sec.section_length >= 10) {
          const area = (sec.width_waste_mm * sec.section_length) / 1000;
          if (area >= 1.0 && area > maxOffcutArea) {
            maxOffcutArea = area;
            majorWidthRem = {
              width: sec.width_waste_mm,
              length: sec.section_length,
              area: area.toFixed(2)
            };
          }
        }
      });

      if (hasLengthRem || majorWidthRem) {
        let buttonsHtml = "";
        let descText = "";

        if (hasLengthRem && majorWidthRem) {
          const lRemArea = ((roll.master_width * roll.remnant_length) / 1000).toFixed(2);
          const inStockL = masterRolls2D.some((r) => r.sourceRollUid === roll.uid && r.width === roll.master_width && r.length === roll.remnant_length);
          const inStockW = masterRolls2D.some((r) => r.sourceRollUid === roll.uid && r.width === majorWidthRem.width && r.length === majorWidthRem.length);
          descText = `Reusable Remnants: Length (${roll.master_width.toLocaleString()} mm &times; ${roll.remnant_length.toLocaleString()} m) and Side Offcut (${majorWidthRem.width.toLocaleString()} mm &times; ${majorWidthRem.length.toLocaleString()} m)`;
          buttonsHtml = `
            <button type="button" class="btn-remnant-2d ${inStockL ? 'btn-remnant-added' : ''}" data-w="${roll.master_width}" data-l="${roll.remnant_length}" data-source-uid="${roll.uid}">
              ${inStockL ? '✓ Length in Stock' : `+ Add Length (${roll.master_width}mm × ${roll.remnant_length}m)`}
            </button>
            <button type="button" class="btn-remnant-2d btn-width-remnant ${inStockW ? 'btn-remnant-added' : ''}" data-w="${majorWidthRem.width}" data-l="${majorWidthRem.length}" data-source-uid="${roll.uid}">
              ${inStockW ? '✓ Offcut in Stock' : `+ Add Offcut (${majorWidthRem.width}mm × ${majorWidthRem.length}m)`}
            </button>
          `;
        } else if (hasLengthRem) {
          const lRemArea = ((roll.master_width * roll.remnant_length) / 1000).toFixed(2);
          const inStock = masterRolls2D.some((r) => r.sourceRollUid === roll.uid && r.width === roll.master_width && r.length === roll.remnant_length);
          descText = `Uncut Roll Remnant: <strong>${roll.master_width.toLocaleString()} mm &times; ${roll.remnant_length.toLocaleString()} m</strong> (${lRemArea} m²)`;
          buttonsHtml = `
            <button type="button" class="btn-remnant-2d ${inStock ? 'btn-remnant-added' : ''}" data-w="${roll.master_width}" data-l="${roll.remnant_length}" data-source-uid="${roll.uid}">
              ${inStock ? '✓ Queued in Stock' : `+ Add Remnant to Stock (${roll.master_width}mm × ${roll.remnant_length}m)`}
            </button>
          `;
        } else if (majorWidthRem) {
          const inStock = masterRolls2D.some((r) => r.sourceRollUid === roll.uid && r.width === majorWidthRem.width && r.length === majorWidthRem.length);
          descText = `Reusable Side Offcut: <strong>${majorWidthRem.width.toLocaleString()} mm &times; ${majorWidthRem.length.toLocaleString()} m</strong> (${majorWidthRem.area} m²)`;
          buttonsHtml = `
            <button type="button" class="btn-remnant-2d btn-width-remnant ${inStock ? 'btn-remnant-added' : ''}" data-w="${majorWidthRem.width}" data-l="${majorWidthRem.length}" data-source-uid="${roll.uid}">
              ${inStock ? '✓ Queued in Stock' : `+ Add Remnant to Stock (${majorWidthRem.width}mm × ${majorWidthRem.length}m)`}
            </button>
          `;
        }

        remnantBannerHtml = `
          <div class="remnant-banner-2d">
            <div class="remnant-desc">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              </svg>
              <span>${descText}</span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${buttonsHtml}
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="roll-card-header">
          <div class="roll-identity">
            <span class="roll-title">2D Roll #${roll.roll_num}</span>
            <span class="roll-capacity-badge">${roll.master_width.toLocaleString()} mm &times; ${roll.master_length.toLocaleString()} m Master</span>
            ${statusTagHtml}
          </div>
          <span class="yield-pill ${pillClass}">
            ${roll.slitting_eff_pct}% Slitting Yield
          </span>
        </div>

        <div class="length-bar-container">
          <div class="length-bar-label">
            <span>Length Slit: <strong>${roll.length_used.toLocaleString()} m</strong> (${pctUsed}%)</span>
            <span>Uncut Remnant: <strong>${roll.remnant_length.toLocaleString()} m</strong> (${pctRemnant}%)</span>
          </div>
          <div class="length-bar-track">
            <div class="length-bar-slit" style="width: ${pctUsed}%;"></div>
            <div class="length-bar-remnant" style="width: ${pctRemnant}%;"></div>
          </div>
        </div>

        <div class="sections-container-2d">
          ${sectionsHtml}
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

        ${remnantBannerHtml}

        ${(() => {
          const trials = roll.candidates_explored && roll.candidates_explored.length > 0
            ? roll.candidates_explored
            : [];
          if (trials.length === 0) return "";

          const trialsRowsHtml = trials.map((t, idx) => `
            <tr class="${t.is_chosen ? 'trial-row-chosen' : ''}">
              <td>
                ${t.is_chosen
              ? '<span class="trial-badge-chosen">✓ Best Chosen</span>'
              : `<span class="trial-badge-alt">Trial #${idx + 1}</span>`}
              </td>
              <td>Run #${t.run_idx || 1} (${t.section_length ? t.section_length.toLocaleString() : ""} m)</td>
              <td>${t.pattern}</td>
              <td>${t.used_width_mm ? t.used_width_mm.toLocaleString() : ""} mm</td>
              <td>${t.width_waste_mm !== undefined ? t.width_waste_mm.toLocaleString() : ""} mm (${t.waste_area_pct}%)</td>
              <td><strong>${t.yield_pct}%</strong></td>
            </tr>
          `).join("");

          return `
            <div class="roll-trials-toggle-row" style="margin-top: 10px;">
              <button type="button" class="btn-view-trials" title="Click to view all slitting combinations the ML model evaluated before selecting this pattern">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>View Combinations Explored (${trials.length} trials)</span>
              </button>
            </div>

            <div class="trials-drawer">
              <div class="trials-header">
                <span>Model Evaluated Trials for 2D Roll #${roll.roll_num} (${roll.master_width.toLocaleString()} mm × ${roll.master_length.toLocaleString()} m)</span>
                <span>${trials.length} candidate combinations generated</span>
              </div>
              <table class="trials-table">
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Run / Section</th>
                    <th>Slitting Combination</th>
                    <th>Used Width</th>
                    <th>Trim Waste</th>
                    <th>Yield</th>
                  </tr>
                </thead>
                <tbody>
                  ${trialsRowsHtml}
                </tbody>
              </table>
            </div>
          `;
        })()}
      `;

      // Event listener: Toggle trials drawer for 2D
      const btnToggleTrials = card.querySelector(".btn-view-trials");
      const drawerTrials = card.querySelector(".trials-drawer");
      if (btnToggleTrials && drawerTrials) {
        const trialsCount = roll.candidates_explored ? roll.candidates_explored.length : 0;
        btnToggleTrials.addEventListener("click", () => {
          drawerTrials.classList.toggle("open");
          const open = drawerTrials.classList.contains("open");
          btnToggleTrials.querySelector("span").textContent = open
            ? `Hide Combinations (${trialsCount} trials)`
            : `View Combinations Explored (${trialsCount} trials)`;
        });
      }

      // Remnant button click listeners (supports both length remnants and width remnants)
      card.querySelectorAll(".btn-remnant-2d").forEach((btn) => {
        btn.addEventListener("click", () => {
          const w = parseInt(btn.getAttribute("data-w"), 10);
          const l = parseInt(btn.getAttribute("data-l"), 10);
          const sourceUid = btn.getAttribute("data-source-uid") || roll.uid;
          const existingIdx = masterRolls2D.findIndex((r) => {
            if (r.sourceRollUid && sourceUid) {
              return r.sourceRollUid === sourceUid && r.width === w && r.length === l;
            }
            return r.width === w && r.length === l;
          });
          if (existingIdx !== -1) {
            masterRolls2D.splice(existingIdx, 1);
            remnantRollSizes2D.delete(`${w}_${l}`);
          } else {
            masterRolls2D.push({ width: w, length: l, qty: 1, isRemnant: true, sourceRollUid: sourceUid });
            remnantRollSizes2D.add(`${w}_${l}`);
          }
          renderRollChips();
          renderPlanResults2D(latestPlanData2D);
        });
      });

      // Mark as cut listener
      const btnCut = card.querySelector(".btn-mark-cut");
      if (btnCut) {
        btnCut.addEventListener("click", () => {
          const uid = roll.uid;
          const stockItem = masterRolls2D.find((r) => r.width === roll.master_width && r.length === roll.master_length);

          if (completedRollIds2D.has(uid)) {
            completedRollIds2D.delete(uid);
            if (stockItem && stockItem.qty !== null) {
              stockItem.qty += 1;
            }
            // Restore quantities
            roll.sections.forEach((sec) => {
              adjustOrderQty(sec.cuts, +1);
            });
          } else {
            completedRollIds2D.add(uid);
            if (stockItem && stockItem.qty !== null && stockItem.qty > 0) {
              stockItem.qty -= 1;
            }
            // Deduct quantities
            roll.sections.forEach((sec) => {
              adjustOrderQty(sec.cuts, -1);
            });
          }
          if (btnReoptimize) {
            btnReoptimize.style.display = (completedRollIds2D.size > 0) ? "inline-flex" : "none";
          }
          renderRollChips();
          renderPlanResults2D(latestPlanData2D);
        });
      }

      // Report Defect listener on 2D roll
      const btnReject = card.querySelector(".btn-report-reject");
      if (btnReject) {
        btnReject.addEventListener("click", () => {
          const allCuts = [];
          roll.sections.forEach((sec) => {
            sec.cuts.forEach((c) => {
              allCuts.push(c);
            });
          });
          if (allCuts.length === 0) return;

          let targetCut = allCuts[0];
          if (allCuts.length > 1) {
            const cutOptions = allCuts.map((c, i) => `${i + 1}) ${c.width}mm x ${c.length}m`).join("\n");
            const input = prompt(`Select defective cut to re-order on Roll #${roll.roll_num}:\n${cutOptions}`, "1");
            const chosenIdx = parseInt(input, 10) - 1;
            if (!isNaN(chosenIdx) && allCuts[chosenIdx]) {
              targetCut = allCuts[chosenIdx];
            }
          }

          let found = false;
          const rows = ordersTbody.querySelectorAll("tr");
          rows.forEach((r) => {
            const wInput = r.querySelector(".order-width");
            const lInput = r.querySelector(".order-length");
            const qInput = r.querySelector(".order-qty");
            const rw = parseInt(wInput ? wInput.value : 0, 10);
            const rl = parseInt(lInput ? lInput.value : 0, 10);
            if (rw === targetCut.width && rl === targetCut.length) {
              qInput.value = (parseInt(qInput.value, 10) || 0) + 1;
              found = true;
            }
          });

          if (!found) {
            createOrderRow(targetCut.width, 1, targetCut.length);
          }

          updateDemandCalculation();
          if (btnReoptimize) btnReoptimize.style.display = "inline-flex";
          showError(`Added 1x (${targetCut.width}mm x ${targetCut.length}mm) reject back to demand backlog. Click "↻ Re-Plan Remaining" to schedule it.`);
        });
      }

      planContainer.appendChild(card);
    });

    syncRemnantButtons2D();
    btnExportImg.style.display = "inline-flex";
    btnPrint.style.display = "inline-flex";
    if (btnExportTrials) btnExportTrials.style.display = "inline-flex";
    if (exportOptionsBar) exportOptionsBar.style.display = "flex";
  }

  // ===================================================================
  // Export Handlers (1D & 2D)
  // ===================================================================
  function toM2(area) {
    if (area === undefined || area === null || isNaN(area)) return "0.00";
    return (Number(area) / 1000).toFixed(2);
  }

  function getRowOrder(row) {
    const wInput = row.querySelector(".order-width");
    const lInput = row.querySelector(".order-length");
    const qInput = row.querySelector(".order-qty");
    const w = wInput ? parseInt(wInput.value, 10) || 0 : 0;
    const l = lInput ? parseInt(lInput.value, 10) || 0 : 0;
    const q = qInput ? parseInt(qInput.value, 10) || 0 : 0;
    return { w, l, q };
  }

  function triggerCanvasDownload(canvas, filename) {
    try {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) {
            downloadViaDataUrl();
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.download = filename;
          link.href = url;
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }, 150);
        }, "image/png");
      } else {
        downloadViaDataUrl();
      }
    } catch (e) {
      downloadViaDataUrl();
    }

    function downloadViaDataUrl() {
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  function exportDesignAsImage() {
    try {
      if (currentMode === "1d") {
        if (!latestPlanData || !latestPlanData.plan || latestPlanData.plan.length === 0) {
          showError("Please calculate a 1D cutting plan first before saving the image.");
          return;
        }
        exportDesignAsImage1D();
      } else {
        if (!latestPlanData2D || !latestPlanData2D.plan || latestPlanData2D.plan.length === 0) {
          showError("Please calculate a 2D cutting plan first before saving the image.");
          return;
        }
        exportDesignAsImage2D();
      }
    } catch (err) {
      console.error("Export Image Failed:", err);
      showError("Image generation failed: " + err.message);
    }
  }

  function exportDesignAsImage1D() {
    if (!latestPlanData || !latestPlanData.plan || latestPlanData.plan.length === 0) return;

    const plan = latestPlanData.plan;
    const summary = latestPlanData.summary;

    const incTrials = chkIncTrials ? chkIncTrials.checked : false;
    const incOrders = chkIncOrders ? chkIncOrders.checked : true;
    const incScrap = chkIncScrap ? chkIncScrap.checked : true;

    // Collect Customer Orders from table
    const orderList = [];
    if (incOrders) {
      ordersTbody.querySelectorAll("tr").forEach((r) => {
        const { w, q } = getRowOrder(r);
        if (w > 0 && q > 0) orderList.push({ width: w, quantity: q });
      });
    }

    const cardHeights = plan.map((roll) => {
      let h = 135; // Header (34px) + Bar (46px) + Manifest (28px) + Padding (27px)
      if (incScrap && roll.waste_mm > 0) h += 36; // Remnant leftover banner
      const trials = (roll.candidates_explored && roll.candidates_explored.length > 0) ? roll.candidates_explored : [];
      if (incTrials && trials.length > 0) {
        h += 38 + trials.length * 22 + 10;
      }
      return h;
    });

    const scale = 2;
    const canvasWidth = 1140;
    const padding = 32;
    const headerHeight = 155;
    const demandCardHeight = (incOrders && orderList.length > 0) ? 76 : 0;
    const cardGap = 16;
    const footerHeight = 45;

    const totalCardsHeight = cardHeights.reduce((sum, h) => sum + h + cardGap, 0);
    const canvasHeight = padding + headerHeight + (demandCardHeight ? demandCardHeight + cardGap : 0) + totalCardsHeight + footerHeight;

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth * scale;
    canvas.height = canvasHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 1. Header & KPI Card
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding, canvasWidth - padding * 2, headerHeight, 8, true, true);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("RollCut OS — Production Cutting Layout (1D Slitting)", padding + 20, padding + 34);

    ctx.fillStyle = "#64748b";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const cutCount = plan.filter((r) => completedRollIds.has(r.uid)).length;
    ctx.fillText(`Generated: ${dateStr}   |   ${summary.rolls_used} Master Rolls Planned (${cutCount} Cut Completed)`, padding + 20, padding + 54);

    // KPI Badges Grid
    const kpiY = padding + 68;
    const kpiBoxW = (canvasWidth - padding * 2 - 40 - 30) / 4;
    const kpiBoxH = 68;

    const kpis = [
      { label: "MATERIAL YIELD", val: `${summary.efficiency_pct}%`, sub: summary.efficiency_pct >= 99 ? "Zero waste slitting" : "Production grade yield", color: "#0284c7" },
      { label: "MASTER ROLLS", val: `${summary.rolls_used} Rolls`, sub: `Capacity: ${summary.total_capacity_mm.toLocaleString()} mm`, color: "#0f172a" },
      { label: "TOTAL DEMAND CUT", val: `${summary.total_demand_mm.toLocaleString()} mm`, sub: `${plan.reduce((sum, r) => sum + r.segments.length, 0)} cuts count`, color: "#0f172a" },
      { label: "TRIM WASTE SCRAP", val: `${summary.total_waste_mm.toLocaleString()} mm`, sub: `${(100 - summary.efficiency_pct).toFixed(2)}% total scrap`, color: summary.total_waste_mm === 0 ? "#059669" : "#dc2626" }
    ];

    kpis.forEach((kpi, idx) => {
      const kx = padding + 20 + idx * (kpiBoxW + 10);
      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = "#e2e8f0";
      roundRect(ctx, kx, kpiY, kpiBoxW, kpiBoxH, 6, true, true);

      ctx.fillStyle = "#64748b";
      ctx.font = "bold 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(kpi.label, kx + 10, kpiY + 18);

      ctx.fillStyle = kpi.color;
      ctx.font = "bold 16px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(kpi.val, kx + 10, kpiY + 40);

      ctx.fillStyle = "#64748b";
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(kpi.sub, kx + 10, kpiY + 57);
    });

    let y = padding + headerHeight + 14;

    // 2. Customer Demand Orders Card (if included)
    if (incOrders && orderList.length > 0) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#cbd5e1";
      roundRect(ctx, padding, y, canvasWidth - padding * 2, demandCardHeight, 8, true, true);

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText("Customer Demand & Backlog Requirements:", padding + 16, y + 22);

      const orderPills = orderList.map((o) => `${o.width}mm (x${o.quantity} pcs)`).join("   •   ");
      ctx.fillStyle = "#334155";
      ctx.font = "12px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(orderPills, padding + 16, y + 44);

      const totalPcs = orderList.reduce((sum, o) => sum + o.quantity, 0);
      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Total Orders: ${summary.total_demand_mm.toLocaleString()} mm (${totalPcs} total pieces)`, padding + 16, y + 64);

      y += demandCardHeight + cardGap;
    }

    // 3. Roll Cards
    plan.forEach((roll, rIdx) => {
      const cardH = cardHeights[rIdx];
      const isCut = completedRollIds.has(roll.uid);

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = isCut ? "#10b981" : "#cbd5e1";
      ctx.lineWidth = isCut ? 1.5 : 1;
      roundRect(ctx, padding, y, canvasWidth - padding * 2, cardH, 8, true, true);

      // Card Header
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Roll #${roll.roll_num} — ${roll.roll_width.toLocaleString()} mm Master Roll`, padding + 18, y + 26);

      // Status Badge
      const statusText = isCut ? "✓ Cut Completed" : "Queued / Ready";
      const statusW = ctx.measureText(statusText).width;
      ctx.fillStyle = isCut ? "#ecfdf5" : "#f1f5f9";
      ctx.strokeStyle = isCut ? "#a7f3d0" : "#cbd5e1";
      roundRect(ctx, padding + 280, y + 11, statusW + 16, 22, 4, true, true);
      ctx.fillStyle = isCut ? "#059669" : "#475569";
      ctx.fillText(statusText, padding + 288, y + 26);

      // Yield Pill (Right aligned)
      ctx.textAlign = "right";
      const isZeroWaste = roll.waste_mm === 0;
      ctx.fillStyle = isZeroWaste ? "#059669" : "#0284c7";
      ctx.font = "bold 13px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(`${roll.efficiency_pct}% Yield (${roll.waste_mm}mm waste)`, canvasWidth - padding - 18, y + 26);
      ctx.textAlign = "left";

      // Visual Cutting Bar
      const barX = padding + 18;
      const barY = y + 42;
      const barW = canvasWidth - padding * 2 - 36;
      const barH = 42;

      ctx.save();
      roundRect(ctx, barX, barY, barW, barH, 5, false, false);
      ctx.clip();

      let currX = barX;
      roll.segments.forEach((seg) => {
        const segW = (seg.pct_of_roll / 100) * barW;
        ctx.fillStyle = getColorForWidth(seg.width);
        ctx.fillRect(currX, barY, segW, barH);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(currX, barY, segW, barH);

        if (segW > 28) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 11px 'SF Mono', Consolas, Monaco, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`${seg.width}`, currX + segW / 2, barY + 26);
          ctx.textAlign = "left";
        }
        currX += segW;
      });

      if (roll.waste_mm > 0) {
        const wasteW = barX + barW - currX;
        ctx.fillStyle = "#fee2e2";
        ctx.fillRect(currX, barY, wasteW, barH);
        ctx.strokeStyle = "#ef4444";
        ctx.strokeRect(currX, barY, wasteW, barH);

        if (wasteW > 32) {
          ctx.fillStyle = "#dc2626";
          ctx.font = "bold 10px 'SF Mono', Consolas, Monaco, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`${roll.waste_mm}mm`, currX + wasteW / 2, barY + 26);
          ctx.textAlign = "left";
        }
      }
      ctx.restore();

      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      roundRect(ctx, barX, barY, barW, barH, 5, false, true);

      // Manifest & Stats Row
      const summaryText = roll.cuts_summary.map((c) => `${c.width}mm × ${c.quantity}`).join("   |   ");
      ctx.fillStyle = "#334155";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Cuts: ${summaryText}`, barX, y + 104);

      ctx.fillStyle = "#64748b";
      ctx.font = "11px 'SF Mono', Consolas, Monaco, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`Used: ${roll.used_mm.toLocaleString()} mm   |   Waste: ${roll.waste_mm.toLocaleString()} mm (${roll.waste_pct}%)`, canvasWidth - padding - 18, y + 104);
      ctx.textAlign = "left";

      let nextSectionY = y + 116;

      // Remnant banner if applicable & included
      if (incScrap && roll.waste_mm > 0) {
        const remY = nextSectionY;
        ctx.fillStyle = "#fffbeb";
        ctx.strokeStyle = "#f59e0b";
        roundRect(ctx, barX, remY, barW, 26, 4, true, true);

        ctx.fillStyle = "#92400e";
        ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        const isReusable = roll.waste_mm >= 500;
        ctx.fillText(`⬡ Leftover Remnant: ${roll.waste_mm.toLocaleString()} mm ${isReusable ? '(Reusable in Next Batch ≥ 500mm)' : '(Edge Trim Scrap)'}`, barX + 10, remY + 17);
        nextSectionY += 34;
      }

      // Evaluated Combination Trials Table (if included)
      const trials = (roll.candidates_explored && roll.candidates_explored.length > 0) ? roll.candidates_explored : [];
      if (incTrials && trials.length > 0) {
        const trialsTableY = nextSectionY + 2;
        const rowH = 22;
        const trialsTableH = 34 + trials.length * rowH;

        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#e2e8f0";
        roundRect(ctx, barX, trialsTableY, barW, trialsTableH, 6, true, true);

        // Header
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(`Model Evaluated Trials for Roll #${roll.roll_num}`, barX + 12, trialsTableY + 18);
        ctx.textAlign = "right";
        ctx.fillStyle = "#64748b";
        ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(`${trials.length} candidate combinations generated`, barX + barW - 12, trialsTableY + 18);
        ctx.textAlign = "left";

        // Column Header
        const colY = trialsTableY + 26;
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(barX, colY, barW, 20);
        ctx.strokeStyle = "#cbd5e1";
        ctx.strokeRect(barX, colY, barW, 20);

        ctx.fillStyle = "#475569";
        ctx.font = "bold 10px 'SF Mono', Consolas, monospace";
        ctx.fillText("DECISION", barX + 10, colY + 14);
        ctx.fillText("CUTS COMBINATION", barX + 110, colY + 14);
        ctx.fillText("USED WIDTH", barX + 660, colY + 14);
        ctx.fillText("WASTE", barX + 790, colY + 14);
        ctx.textAlign = "right";
        ctx.fillText("YIELD %", barX + barW - 12, colY + 14);
        ctx.textAlign = "left";

        // Rows
        let rowY = colY + 20;
        trials.forEach((t, tIdx) => {
          if (t.is_chosen) {
            ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
            ctx.fillRect(barX, rowY, barW, rowH);
          } else if (tIdx % 2 === 1) {
            ctx.fillStyle = "rgba(241, 245, 249, 0.4)";
            ctx.fillRect(barX, rowY, barW, rowH);
          }
          ctx.strokeStyle = "#e2e8f0";
          ctx.strokeRect(barX, rowY, barW, rowH);

          if (t.is_chosen) {
            ctx.fillStyle = "#10b981";
            roundRect(ctx, barX + 8, rowY + 3, 76, 16, 3, true, false);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 9px 'SF Mono', Consolas, monospace";
            ctx.fillText("✓ CHOSEN", barX + 16, rowY + 15);
          } else {
            ctx.fillStyle = "#64748b";
            ctx.font = "10px 'SF Mono', Consolas, monospace";
            ctx.fillText(`Trial #${tIdx + 1}`, barX + 10, rowY + 15);
          }

          ctx.fillStyle = t.is_chosen ? "#065f46" : "#334155";
          ctx.font = t.is_chosen ? "bold 10px 'SF Mono', Consolas, monospace" : "10px 'SF Mono', Consolas, monospace";
          let patText = t.pattern || "";
          if (patText.length > 70) patText = patText.slice(0, 67) + "...";
          ctx.fillText(patText, barX + 110, rowY + 15);
          ctx.fillText(`${t.used_mm ? t.used_mm.toLocaleString() : ""} mm`, barX + 660, rowY + 15);
          ctx.fillText(`${t.waste_mm !== undefined ? t.waste_mm.toLocaleString() : "0"} mm (${t.waste_pct}%)`, barX + 790, rowY + 15);
          ctx.textAlign = "right";
          ctx.fillText(`${t.efficiency_pct}%`, barX + barW - 12, rowY + 15);
          ctx.textAlign = "left";

          rowY += rowH;
        });
      }

      y += cardH + cardGap;
    });

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("Exported from RollCut OS Industrial Slitter Optimization System", padding + 18, y + 22);

    triggerCanvasDownload(canvas, `RollCut_1D_Cutting_Plan_${new Date().toISOString().slice(0, 10)}.png`);
  }

  function exportDesignAsImage2D() {
    if (!latestPlanData2D || !latestPlanData2D.plan || latestPlanData2D.plan.length === 0) return;

    const plan = latestPlanData2D.plan;
    const summary = latestPlanData2D.summary;

    const incTrials = chkIncTrials ? chkIncTrials.checked : false;
    const incOrders = chkIncOrders ? chkIncOrders.checked : true;
    const incScrap = chkIncScrap ? chkIncScrap.checked : true;

    // Collect Customer Demand items from table
    const orderList = [];
    if (incOrders) {
      ordersTbody.querySelectorAll("tr").forEach((r) => {
        const { w, l, q } = getRowOrder(r);
        if (w > 0 && l > 0 && q > 0) {
          orderList.push({ width: w, length: l, quantity: q });
        }
      });
    }

    // Compute dynamic heights for each roll card
    const cardHeights = plan.map((roll) => {
      let h = 88; // header (46px) + length bar (42px)
      h += roll.sections.length * 114; // each section: header (26px) + lane bar (40px) + manifest (26px) + gaps (22px)
      const hasLengthRem = roll.remnant_length >= 10;
      const hasWidthRem = roll.sections.some((s) => s.width_waste_mm >= 150 && s.section_length >= 10);
      if (incScrap && (hasLengthRem || hasWidthRem)) {
        h += 46;
      }
      const trials = roll.candidates_explored || [];
      if (incTrials && trials.length > 0) {
        h += 38 + trials.length * 22 + 10;
      }
      return h + 18;
    });

    const scale = 2;
    const canvasWidth = 1140;
    const padding = 32;
    const headerHeight = 155;
    const demandCardHeight = (incOrders && orderList.length > 0) ? 76 : 0;
    const cardGap = 18;
    const footerHeight = 45;

    const totalCardsHeight = cardHeights.reduce((sum, h) => sum + h + cardGap, 0);
    const canvasHeight = padding + headerHeight + (demandCardHeight ? demandCardHeight + cardGap : 0) + totalCardsHeight + footerHeight;

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth * scale;
    canvas.height = canvasHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 1. Header Card with Full KPI Dashboard
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding, canvasWidth - padding * 2, headerHeight, 8, true, true);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("RollCut OS — 2D Slitting & Sheeting Production Plan", padding + 20, padding + 34);

    ctx.fillStyle = "#64748b";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const cutCount = plan.filter((r) => completedRollIds2D.has(r.uid)).length;
    ctx.fillText(`Generated: ${dateStr}   |   ${summary.rolls_used} 2D Master Rolls Planned (${cutCount} Cut Completed)`, padding + 20, padding + 54);

    // 4 KPI Cards
    const kpiY = padding + 68;
    const kpiBoxW = (canvasWidth - padding * 2 - 40 - 30) / 4;
    const kpiBoxH = 68;

    const kpis = [
      { label: "SLITTING EFFICIENCY", val: `${summary.slitting_efficiency_pct}%`, sub: "Operational slitting yield", color: "#0284c7" },
      { label: "MASTER ROLLS", val: `${summary.rolls_used} Rolls`, sub: `Allocated: ${toM2(summary.total_roll_area_allocated)} m²`, color: "#0f172a" },
      { label: "PRODUCT CUT DEMAND", val: `${toM2(summary.total_product_cut_area)} m²`, sub: `${plan.reduce((sum, r) => sum + r.sections.reduce((s, sec) => s + sec.cuts.reduce((csum, c) => csum + c.quantity, 0), 0), 0)} rolls cut`, color: "#0f172a" },
      { label: "NET SCRAP & REMNANTS", val: `${toM2(summary.net_scrap_area)} m² scrap`, sub: `${summary.net_scrap_pct}% scrap • ${toM2(summary.total_reusable_remnant)} m² saved`, color: "#dc2626" }
    ];

    kpis.forEach((kpi, idx) => {
      const kx = padding + 20 + idx * (kpiBoxW + 10);
      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = "#e2e8f0";
      roundRect(ctx, kx, kpiY, kpiBoxW, kpiBoxH, 6, true, true);

      ctx.fillStyle = "#64748b";
      ctx.font = "bold 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(kpi.label, kx + 10, kpiY + 18);

      ctx.fillStyle = kpi.color;
      ctx.font = "bold 16px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(kpi.val, kx + 10, kpiY + 40);

      ctx.fillStyle = "#64748b";
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(kpi.sub, kx + 10, kpiY + 57);
    });

    let y = padding + headerHeight + 14;

    // 2. Customer Demand Orders Card
    if (orderList.length > 0) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#cbd5e1";
      roundRect(ctx, padding, y, canvasWidth - padding * 2, demandCardHeight, 8, true, true);

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText("Customer Demand & Backlog Requirements:", padding + 16, y + 22);

      const orderPills = orderList.map((o) => `${o.width}mm × ${o.length}m (${o.quantity} rolls)`).join("   •   ");
      ctx.fillStyle = "#334155";
      ctx.font = "12px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(orderPills, padding + 16, y + 44);

      const totalDemandArea = orderList.reduce((sum, o) => sum + (o.width * o.length * o.quantity), 0);
      const totalDemandRolls = orderList.reduce((sum, o) => sum + o.quantity, 0);
      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Total Orders: ${toM2(totalDemandArea)} m² (${totalDemandRolls} rolls total)`, padding + 16, y + 64);

      y += demandCardHeight + cardGap;
    }

    // 3. Roll Cards
    plan.forEach((roll, rIdx) => {
      const cardH = cardHeights[rIdx];
      const isCut = completedRollIds2D.has(roll.uid);

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = isCut ? "#10b981" : "#cbd5e1";
      ctx.lineWidth = isCut ? 1.5 : 1;
      roundRect(ctx, padding, y, canvasWidth - padding * 2, cardH, 8, true, true);

      // Card Header
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`2D Roll #${roll.roll_num}`, padding + 18, y + 26);

      // Master Size Badge
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const sizeStr = `${roll.master_width.toLocaleString()} mm × ${roll.master_length.toLocaleString()} m Master`;
      const sizeW = ctx.measureText(sizeStr).width;
      ctx.fillStyle = "#f1f5f9";
      ctx.strokeStyle = "#cbd5e1";
      roundRect(ctx, padding + 130, y + 11, sizeW + 16, 22, 4, true, true);
      ctx.fillStyle = "#334155";
      ctx.fillText(sizeStr, padding + 138, y + 26);

      // Status Badge (Queued/Ready or Cut Completed)
      const statusText = isCut ? "✓ Cut Completed" : "Queued / Ready";
      const statusW = ctx.measureText(statusText).width;
      ctx.fillStyle = isCut ? "#ecfdf5" : "#f1f5f9";
      ctx.strokeStyle = isCut ? "#a7f3d0" : "#cbd5e1";
      roundRect(ctx, padding + 154 + sizeW, y + 11, statusW + 16, 22, 4, true, true);
      ctx.fillStyle = isCut ? "#059669" : "#475569";
      ctx.fillText(statusText, padding + 162 + sizeW, y + 26);

      // Slitting Yield Pill (Right aligned)
      ctx.textAlign = "right";
      ctx.fillStyle = "#0284c7";
      ctx.font = "bold 13px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(`${roll.slitting_eff_pct}% Slitting Yield`, canvasWidth - padding - 18, y + 26);
      ctx.textAlign = "left";

      // Length Utilization Track Bar
      const pctUsed = Math.min(100, Math.round((roll.length_used / roll.master_length) * 100));
      const pctRem = Math.max(0, 100 - pctUsed);
      const trackX = padding + 18;
      let currY = y + 42;
      const trackW = canvasWidth - padding * 2 - 36;

      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Length Slit: ${roll.length_used.toLocaleString()} m (${pctUsed}%)`, trackX, currY + 12);
      ctx.textAlign = "right";
      ctx.fillText(`Uncut Remnant: ${roll.remnant_length.toLocaleString()} m (${pctRem}%)`, trackX + trackW, currY + 12);
      ctx.textAlign = "left";

      currY += 18;
      const barH = 14;
      ctx.save();
      roundRect(ctx, trackX, currY, trackW, barH, 4, false, false);
      ctx.clip();
      ctx.fillStyle = "#0284c7";
      ctx.fillRect(trackX, currY, (pctUsed / 100) * trackW, barH);
      ctx.fillStyle = "#fef3c7";
      ctx.fillRect(trackX + (pctUsed / 100) * trackW, currY, (pctRem / 100) * trackW, barH);
      ctx.restore();
      ctx.strokeStyle = "#cbd5e1";
      roundRect(ctx, trackX, currY, trackW, barH, 4, false, true);

      currY += barH + 14;

      // Draw ALL sections / slitting runs
      roll.sections.forEach((sec, sIdx) => {
        const secH = 102;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#e2e8f0";
        roundRect(ctx, trackX, currY, trackW, secH, 6, true, true);

        // Section header
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(`Run #${sIdx + 1}   Length: ${sec.section_length.toLocaleString()} m`, trackX + 12, currY + 20);

        ctx.textAlign = "right";
        ctx.fillStyle = "#475569";
        ctx.font = "11px 'SF Mono', Consolas, Monaco, monospace";
        ctx.fillText(`Width: ${sec.used_width_mm.toLocaleString()} / ${roll.master_width.toLocaleString()} mm  •  Trim: ${sec.width_waste_mm} mm (${sec.waste_area_pct}%)`, trackX + trackW - 12, currY + 20);
        ctx.textAlign = "left";

        // Slitting Bar
        const slitBarY = currY + 28;
        const slitBarH = 36;
        ctx.save();
        roundRect(ctx, trackX + 12, slitBarY, trackW - 24, slitBarH, 4, false, false);
        ctx.clip();

        let laneX = trackX + 12;
        const barInnerW = trackW - 24;

        sec.cuts.forEach((cut) => {
          const color = getColorForWidth(cut.width);
          for (let p = 0; p < cut.quantity; p++) {
            const laneW = (cut.width / roll.master_width) * barInnerW;
            ctx.fillStyle = color;
            ctx.fillRect(laneX, slitBarY, laneW, slitBarH);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.strokeRect(laneX, slitBarY, laneW, slitBarH);

            if (laneW > 28) {
              ctx.fillStyle = "#ffffff";
              ctx.font = "bold 11px 'SF Mono', Consolas, Monaco, monospace";
              ctx.textAlign = "center";
              ctx.fillText(`${cut.width}`, laneX + laneW / 2, slitBarY + 22);
              ctx.textAlign = "left";
            }
            laneX += laneW;
          }
        });

        // Trim Waste Segment
        if (sec.width_waste_mm > 0) {
          const wasteW = (trackX + 12 + barInnerW) - laneX;
          const isWidthRem = sec.is_width_remnant || sec.width_waste_mm >= 150;
          ctx.fillStyle = isWidthRem ? "#dbeafe" : "#fee2e2";
          ctx.fillRect(laneX, slitBarY, wasteW, slitBarH);
          ctx.strokeStyle = isWidthRem ? "#3b82f6" : "#ef4444";
          ctx.strokeRect(laneX, slitBarY, wasteW, slitBarH);

          if (wasteW > 30) {
            ctx.fillStyle = isWidthRem ? "#1d4ed8" : "#dc2626";
            ctx.font = "bold 10px 'SF Mono', Consolas, Monaco, monospace";
            ctx.textAlign = "center";
            const label = isWidthRem ? `${sec.width_waste_mm}mm offcut` : `${sec.width_waste_mm}mm trim`;
            ctx.fillText(label, laneX + wasteW / 2, slitBarY + 22);
            ctx.textAlign = "left";
          }
        }
        ctx.restore();
        ctx.strokeStyle = "#cbd5e1";
        roundRect(ctx, trackX + 12, slitBarY, trackW - 24, slitBarH, 4, false, true);

        // Section Manifest Items
        const manifestText = sec.cuts.map((c) => `${c.width}mm × ${c.length}m (x${c.quantity} rolls)`).join("   |   ");
        ctx.fillStyle = "#334155";
        ctx.font = "11px 'SF Mono', Consolas, Monaco, monospace";
        ctx.fillText(manifestText, trackX + 12, currY + 86);

        currY += secH + 10;
      });

      // Reusable Remnants Banner (if applicable)
      const hasLengthRem = roll.remnant_length >= 10;
      let majorWidthRem = null;
      let maxOffcutArea = 0;
      roll.sections.forEach((sec) => {
        if (sec.width_waste_mm >= 150 && sec.section_length >= 10) {
          const area = (sec.width_waste_mm * sec.section_length) / 1000;
          if (area >= 1.0 && area > maxOffcutArea) {
            maxOffcutArea = area;
            majorWidthRem = { width: sec.width_waste_mm, length: sec.section_length, area: area.toFixed(2) };
          }
        }
      });

      if (incScrap && (hasLengthRem || majorWidthRem)) {
        ctx.fillStyle = "#fffbeb";
        ctx.strokeStyle = "#f59e0b";
        roundRect(ctx, trackX, currY, trackW, 34, 6, true, true);

        let descText = "";
        if (hasLengthRem && majorWidthRem) {
          descText = `Reusable Remnants: Length (${roll.master_width.toLocaleString()} mm × ${roll.remnant_length.toLocaleString()} m) and Side Offcut (${majorWidthRem.width.toLocaleString()} mm × ${majorWidthRem.length.toLocaleString()} m)`;
        } else if (hasLengthRem) {
          const lArea = toM2(roll.master_width * roll.remnant_length);
          descText = `Uncut Roll Remnant: ${roll.master_width.toLocaleString()} mm × ${roll.remnant_length.toLocaleString()} m (${lArea} m²)`;
        } else if (majorWidthRem) {
          descText = `Reusable Side Offcut: ${majorWidthRem.width.toLocaleString()} mm × ${majorWidthRem.length.toLocaleString()} m (${majorWidthRem.area} m²)`;
        }

        ctx.fillStyle = "#92400e";
        ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(`⬡ ${descText}`, trackX + 12, currY + 21);
        currY += 44;
      }

      // Evaluated Candidate Trials Table (if included)
      const trials = roll.candidates_explored || [];
      if (incTrials && trials.length > 0) {
        const trialsTableY = currY + 2;
        const rowH = 22;
        const trialsTableH = 34 + trials.length * rowH;

        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#e2e8f0";
        roundRect(ctx, trackX, trialsTableY, trackW, trialsTableH, 6, true, true);

        // Header
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(`Model Evaluated Trials for 2D Roll #${roll.roll_num}`, trackX + 12, trialsTableY + 18);
        ctx.textAlign = "right";
        ctx.fillStyle = "#64748b";
        ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(`${trials.length} candidate combinations generated`, trackX + trackW - 12, trialsTableY + 18);
        ctx.textAlign = "left";

        // Column Header
        const colY = trialsTableY + 26;
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(trackX, colY, trackW, 20);
        ctx.strokeStyle = "#cbd5e1";
        ctx.strokeRect(trackX, colY, trackW, 20);

        ctx.fillStyle = "#475569";
        ctx.font = "bold 10px 'SF Mono', Consolas, monospace";
        ctx.fillText("DECISION", trackX + 10, colY + 14);
        ctx.fillText("RUN", trackX + 100, colY + 14);
        ctx.fillText("SLITTING COMBINATION", trackX + 180, colY + 14);
        ctx.fillText("USED WIDTH", trackX + 660, colY + 14);
        ctx.fillText("TRIM WASTE", trackX + 780, colY + 14);
        ctx.textAlign = "right";
        ctx.fillText("SLITTING YIELD", trackX + trackW - 12, colY + 14);
        ctx.textAlign = "left";

        // Rows
        let rowY = colY + 20;
        trials.forEach((t, tIdx) => {
          if (t.is_chosen) {
            ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
            ctx.fillRect(trackX, rowY, trackW, rowH);
          } else if (tIdx % 2 === 1) {
            ctx.fillStyle = "rgba(241, 245, 249, 0.4)";
            ctx.fillRect(trackX, rowY, trackW, rowH);
          }
          ctx.strokeStyle = "#e2e8f0";
          ctx.strokeRect(trackX, rowY, trackW, rowH);

          if (t.is_chosen) {
            ctx.fillStyle = "#10b981";
            roundRect(ctx, trackX + 8, rowY + 3, 76, 16, 3, true, false);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 9px 'SF Mono', Consolas, monospace";
            ctx.fillText("✓ CHOSEN", trackX + 16, rowY + 15);
          } else {
            ctx.fillStyle = "#64748b";
            ctx.font = "10px 'SF Mono', Consolas, monospace";
            ctx.fillText(`Trial #${tIdx + 1}`, trackX + 10, rowY + 15);
          }

          ctx.fillStyle = t.is_chosen ? "#065f46" : "#334155";
          ctx.font = t.is_chosen ? "bold 10px 'SF Mono', Consolas, monospace" : "10px 'SF Mono', Consolas, monospace";
          ctx.fillText(`Run #${t.run_idx || 1}`, trackX + 100, rowY + 15);

          let patText = t.pattern || "";
          if (patText.length > 65) patText = patText.slice(0, 62) + "...";
          ctx.fillText(patText, trackX + 180, rowY + 15);

          ctx.fillText(`${t.used_width_mm ? t.used_width_mm.toLocaleString() : ""} mm`, trackX + 660, rowY + 15);
          ctx.fillText(`${t.width_waste_mm !== undefined ? t.width_waste_mm : ""} mm (${t.waste_area_pct}%)`, trackX + 780, rowY + 15);

          ctx.textAlign = "right";
          ctx.fillText(`${t.yield_pct}%`, trackX + trackW - 12, rowY + 15);
          ctx.textAlign = "left";

          rowY += rowH;
        });
      }

      y += cardH + cardGap;
    });

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("Exported from RollCut OS 2D Slitting Optimization Engine", padding + 18, y + 22);

    triggerCanvasDownload(canvas, `RollCut_2D_Cutting_Plan_${new Date().toISOString().slice(0, 10)}.png`);
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (width <= 0 || height <= 0) return;
    if (typeof radius === "number") {
      radius = { tl: radius, tr: radius, br: radius, bl: radius };
    }
    const maxR = Math.min(width / 2, height / 2);
    const rTl = Math.min(radius.tl || 0, maxR);
    const rTr = Math.min(radius.tr || 0, maxR);
    const rBr = Math.min(radius.br || 0, maxR);
    const rBl = Math.min(radius.bl || 0, maxR);

    ctx.beginPath();
    ctx.moveTo(x + rTl, y);
    ctx.lineTo(x + width - rTr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + rTr);
    ctx.lineTo(x + width, y + height - rBr);
    ctx.quadraticCurveTo(x + width, y + height, x + width - rBr, y + height);
    ctx.lineTo(x + rBl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - rBl);
    ctx.lineTo(x, y + rTl);
    ctx.quadraticCurveTo(x, y, x + rTl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  btnExportImg.addEventListener("click", exportDesignAsImage);

  function captureActiveOrdersTableState() {
    const rowsState = [];
    ordersTbody.querySelectorAll("tr").forEach((r) => {
      const wInput = r.querySelector(".order-width");
      const lInput = r.querySelector(".order-length");
      const qInput = r.querySelector(".order-qty");
      rowsState.push({
        width: wInput ? wInput.value : "",
        length: lInput ? lInput.value : "",
        qty: qInput ? qInput.value : ""
      });
    });
    return rowsState;
  }

  function renderOrdersFromSnapshot(snapshot) {
    ordersTbody.innerHTML = "";
    if (currentMode === "1d") {
      snapshot.forEach((item) => {
        createOrderRow(item.width, item.quantity);
      });
    } else {
      snapshot.forEach((item) => {
        createOrderRow(item.width, item.quantity, item.length);
      });
    }
    updateDemandCalculation();
  }

  function restoreActiveOrdersTableState(rowsState) {
    ordersTbody.innerHTML = "";
    if (rowsState.length === 0) {
      createOrderRow();
    } else {
      rowsState.forEach((item) => {
        if (currentMode === "1d") {
          createOrderRow(item.width, item.qty);
        } else {
          createOrderRow(item.width, item.qty, item.length);
        }
      });
    }
    updateDemandCalculation();
  }

  // --- Print Work Order ---
  btnPrint.addEventListener("click", () => {
    const incTrials = chkIncTrials ? chkIncTrials.checked : false;
    const incOrders = chkIncOrders ? chkIncOrders.checked : true;
    const incScrap = chkIncScrap ? chkIncScrap.checked : true;

    document.body.classList.toggle("print-include-trials", incTrials);
    document.body.classList.toggle("print-exclude-orders", !incOrders);
    document.body.classList.toggle("print-exclude-scrap", !incScrap);

    const activeState = captureActiveOrdersTableState();
    const snapshot = currentMode === "1d" ? originalOrdersSnapshot1D : originalOrdersSnapshot2D;

    if (snapshot && snapshot.length > 0) {
      renderOrdersFromSnapshot(snapshot);
    }

    try {
      window.print();
    } finally {
      restoreActiveOrdersTableState(activeState);
    }
  });

  // --- Export Excel (.xlsx) ---
  function downloadExplorationSpreadsheet() {
    if (currentMode === "1d") {
      downloadExplorationSpreadsheet1D();
    } else {
      downloadExplorationSpreadsheet2D();
    }
  }

  function downloadExplorationSpreadsheet1D() {
    if (!latestPlanData || !latestPlanData.plan || latestPlanData.plan.length === 0) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `RollCut_1D_Production_Plan_${dateStr}.xlsx`;

    if (typeof XLSX !== "undefined") {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Customer Demand Orders
      const ordersData1D = [
        ["Order Line #", "Cut Width (mm)", "Required Quantity (pcs)", "Total Demand Length (mm)"]
      ];
      let totPieces = 0;
      let totDemandMm = 0;
      ordersTbody.querySelectorAll("tr").forEach((r, idx) => {
        const { w, q } = getRowOrder(r);
        if (w > 0 && q > 0) {
          totPieces += q;
          totDemandMm += (w * q);
          ordersData1D.push([idx + 1, w, q, w * q]);
        }
      });
      ordersData1D.push([]);
      ordersData1D.push(["TOTALS", "", totPieces, totDemandMm]);
      const wsOrders1D = XLSX.utils.aoa_to_sheet(ordersData1D);
      XLSX.utils.book_append_sheet(wb, wsOrders1D, "Customer Demand Orders");

      // Sheet 2: 1D Production Plan
      const planData = [
        [
          "Roll Number",
          "Status",
          "Master Roll Width (mm)",
          "Cut Pattern Summary",
          "Total Cuts Count",
          "Used Width (mm)",
          "Waste Scrap Width (mm)",
          "Yield %",
          "Scrap %",
          "Leftover Reusable Status"
        ]
      ];

      latestPlanData.plan.forEach((roll) => {
        const isCut = completedRollIds.has(roll.uid);
        const patternSummary = roll.cuts_summary
          .map((cut) => `${cut.width}mm x ${cut.quantity}`)
          .join(" | ");
        const totalCuts = roll.cuts_summary.reduce((sum, c) => sum + c.quantity, 0);
        const remnantStatus = roll.waste_mm >= 500
          ? `Reusable Remnant (${roll.waste_mm}mm)`
          : (roll.waste_mm > 0 ? `Edge Scrap (${roll.waste_mm}mm)` : "100% Zero-Waste");

        planData.push([
          `Roll #${roll.roll_num}`,
          isCut ? "Cut Completed" : "Queued / Ready",
          roll.roll_width,
          patternSummary,
          totalCuts,
          roll.used_mm,
          roll.waste_mm,
          `${roll.efficiency_pct}%`,
          `${roll.waste_pct}%`,
          remnantStatus
        ]);
      });

      const summary = latestPlanData.summary;
      planData.push([]);
      planData.push([
        "BATCH TOTALS",
        `${latestPlanData.plan.filter((r) => completedRollIds.has(r.uid)).length}/${summary.rolls_used} Cut`,
        summary.total_capacity_mm,
        `${summary.rolls_used} Master Rolls Planned`,
        latestPlanData.plan.reduce((sum, r) => sum + r.cuts_summary.reduce((s, c) => s + c.quantity, 0), 0),
        summary.total_demand_mm,
        summary.total_waste_mm,
        `${summary.efficiency_pct}%`,
        `${(100 - summary.efficiency_pct).toFixed(2)}%`,
        ""
      ]);

      const wsPlan = XLSX.utils.aoa_to_sheet(planData);
      XLSX.utils.book_append_sheet(wb, wsPlan, "1D Production Plan");

      // Sheet 3: Model Explored Trials
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
        trialsData.push([]);
      });

      const wsTrials = XLSX.utils.aoa_to_sheet(trialsData);
      XLSX.utils.book_append_sheet(wb, wsTrials, "Model Explored Trials");

      XLSX.writeFile(wb, filename);
    }
  }

  function downloadExplorationSpreadsheet2D() {
    if (!latestPlanData2D || !latestPlanData2D.plan || latestPlanData2D.plan.length === 0) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `RollCut_2D_Production_Plan_${dateStr}.xlsx`;

    if (typeof XLSX !== "undefined") {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Customer Demand Orders
      const ordersData2D = [
        [
          "Order Line #",
          "Cut Width (mm)",
          "Cut Length (m)",
          "Required Quantity (rolls)",
          "Product Area Cut (m²)"
        ]
      ];
      let orderTotalArea = 0;
      let orderTotalRolls = 0;
      ordersTbody.querySelectorAll("tr").forEach((r, idx) => {
        const { w, l, q } = getRowOrder(r);
        if (w > 0 && l > 0 && q > 0) {
          const area = (w * l * q) / 1000;
          orderTotalArea += area;
          orderTotalRolls += q;
          ordersData2D.push([idx + 1, w, l, q, area.toFixed(2)]);
        }
      });
      ordersData2D.push([]);
      ordersData2D.push(["TOTAL DEMAND", "", "", orderTotalRolls, orderTotalArea.toFixed(2)]);
      const wsOrders2D = XLSX.utils.aoa_to_sheet(ordersData2D);
      XLSX.utils.book_append_sheet(wb, wsOrders2D, "Customer Demand Orders");

      // Sheet 2: Master Rolls Plan & Comprehensive Scrap Breakdown
      const sum = latestPlanData2D.summary;
      const plan2DRows = [
        [
          "Roll Number",
          "Status",
          "Master Width (mm)",
          "Master Length (m)",
          "Length Slit (m)",
          "Uncut Remnant Length (m)",
          "Slitting Yield %",
          "Product Area Cut (m²)",
          "Allocated Roll Area (m²)",
          "Gross Section Trim Scrap (m²)",
          "Uncut Length Remnant (m²)",
          "Reusable Side Offcut (m²)",
          "Total Reusable Remnants (m²)",
          "Net Non-Reusable Scrap (m²)",
          "Net Scrap %"
        ]
      ];

      latestPlanData2D.plan.forEach((r) => {
        const isCut = completedRollIds2D.has(r.uid);
        const lRemArea = (r.remnant_area || 0) / 1000;
        const wRemArea = (r.total_width_remnant_area || 0) / 1000;
        const totReusable = lRemArea + wRemArea;
        const grossTrim = (r.section_waste_area || 0) / 1000;
        const netScrap = Math.max(0, grossTrim - wRemArea);
        const rollAllocArea = (r.roll_area || 1) / 1000;
        const netScrapPct = ((netScrap / rollAllocArea) * 100).toFixed(2);

        plan2DRows.push([
          `Roll #${r.roll_num}`,
          isCut ? "Cut Completed" : "Queued / Ready",
          r.master_width,
          r.master_length,
          r.length_used,
          r.remnant_length,
          `${r.slitting_eff_pct}%`,
          (r.total_used_area / 1000).toFixed(2),
          rollAllocArea.toFixed(2),
          grossTrim.toFixed(2),
          lRemArea.toFixed(2),
          wRemArea.toFixed(2),
          totReusable.toFixed(2),
          netScrap.toFixed(2),
          `${netScrapPct}%`
        ]);
      });

      plan2DRows.push([]);
      plan2DRows.push([
        "BATCH TOTALS",
        `${latestPlanData2D.plan.filter((r) => completedRollIds2D.has(r.uid)).length}/${sum.rolls_used} Cut`,
        "",
        "",
        "",
        "",
        `${sum.slitting_efficiency_pct}%`,
        toM2(sum.total_product_cut_area),
        toM2(sum.total_roll_area_allocated),
        toM2(sum.total_slitting_trim_waste),
        toM2(sum.total_length_remnant),
        toM2(sum.total_width_remnant),
        toM2(sum.total_reusable_remnant),
        toM2(sum.net_scrap_area),
        `${sum.net_scrap_pct}%`
      ]);

      const wsPlan2D = XLSX.utils.aoa_to_sheet(plan2DRows);
      XLSX.utils.book_append_sheet(wb, wsPlan2D, "2D Master Rolls & Scrap");

      // Sheet 3: Sections and Slitting Runs
      const secRows = [
        [
          "Roll Number",
          "Run / Section #",
          "Run Length (m)",
          "Master Width (mm)",
          "Used Width (mm)",
          "Trim Waste Width (mm)",
          "Trim Scrap %",
          "Cuts Produced"
        ]
      ];

      latestPlanData2D.plan.forEach((r) => {
        r.sections.forEach((s, sIdx) => {
          const cutsPattern = s.cuts.map((c) => `${c.width}mm x ${c.length}m (x${c.quantity} rolls)`).join(" | ");
          secRows.push([
            `Roll #${r.roll_num}`,
            sIdx + 1,
            s.section_length,
            r.master_width,
            s.used_width_mm,
            s.width_waste_mm,
            `${s.waste_area_pct}%`,
            cutsPattern
          ]);
        });
      });

      const wsSec2D = XLSX.utils.aoa_to_sheet(secRows);
      XLSX.utils.book_append_sheet(wb, wsSec2D, "2D Slitting Runs & Cuts");

      // Sheet 4: Model Explored Trials and Combinations
      const trialsData2D = [
        [
          "Master Roll #",
          "Master Roll Size",
          "Decision Status",
          "Run / Section #",
          "Section Length (m)",
          "Slitting Cuts Combination",
          "Used Width (mm)",
          "Trim Waste Width (mm)",
          "Trim Scrap Area %",
          "Slitting Yield %"
        ]
      ];

      latestPlanData2D.plan.forEach((roll) => {
        const trials = roll.candidates_explored || [];
        trials.forEach((t, idx) => {
          trialsData2D.push([
            `Roll #${roll.roll_num}`,
            `${roll.master_width}mm × ${roll.master_length}m`,
            t.is_chosen ? "✓ SELECTED (BEST COMBINATION)" : `Alternative Trial #${idx + 1}`,
            `Run #${t.run_idx || 1}`,
            t.section_length,
            t.pattern,
            t.used_width_mm,
            t.width_waste_mm,
            `${t.waste_area_pct}%`,
            `${t.yield_pct}%`
          ]);
        });
        if (trials.length > 0) trialsData2D.push([]);
      });

      const wsTrials2D = XLSX.utils.aoa_to_sheet(trialsData2D);
      XLSX.utils.book_append_sheet(wb, wsTrials2D, "2D Model Explored Trials");

      XLSX.writeFile(wb, filename);
    }
  }

  if (btnExportTrials) {
    btnExportTrials.addEventListener("click", downloadExplorationSpreadsheet);
  }

  // --- Initial Setup ---
  try {
    localStorage.clear();
  } catch (e) { }

  createOrderRow();
  renderRollChips();
  updateDemandCalculation();
});
