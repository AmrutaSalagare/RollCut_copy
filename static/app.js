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
  const inputNewRollId = document.getElementById("input-new-roll-id");
  const inputNewRoll = document.getElementById("input-new-roll");
  const inputNewRollLen = document.getElementById("input-new-roll-len");
  const inputNewRollQty = document.getElementById("input-new-roll-qty");
  const inputNewRollMat = document.getElementById("input-new-roll-mat");
  const inputNewRollGsm = document.getElementById("input-new-roll-gsm");
  const thOrderMat = document.getElementById("th-order-mat");
  const thOrderCust = document.getElementById("th-order-cust");
  const thOrderItem = document.getElementById("th-order-item");

  // Material codes are compared case-insensitively; "" = no material given
  const normMat = (v) => String(v || "").trim().toUpperCase();
  const btnAddRoll = document.getElementById("btn-add-roll");
  const btnClearRolls = document.getElementById("btn-clear-rolls");

  // DOM Elements - Customer Orders Table
  const orderPanelNote = document.getElementById("order-panel-note");
  const thOrderId = document.getElementById("th-order-id");
  const thOrderW = document.getElementById("th-order-w");
  const thOrderL = document.getElementById("th-order-l");
  const thOrderQ = document.getElementById("th-order-q");
  const thOrderDate = document.getElementById("th-order-date");
  const thOrderDel = document.getElementById("th-order-del");
  const ordersTbody = document.getElementById("orders-tbody");
  const btnAddOrderRow = document.getElementById("btn-add-order-row");
  const btnClearOrders = document.getElementById("btn-clear-orders");
  const btnImportCsv = document.getElementById("btn-import-csv");
  const csvFileInput = document.getElementById("csv-file-input");
  const demandCounter = document.getElementById("demand-counter");

  // Side-map: tracks which order IDs contributed to each (width_length) key
  // Built fresh on every optimize call; used purely for dispatch labelling.
  let orderIdMap = {}; // e.g. { "900_2000": [{order_id,order_date,delivery_date,qty},...] }

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
  const btnCancelPlan = document.getElementById("btn-cancel-plan");

  // DOM Elements - Exports
  const btnExportImg = document.getElementById("btn-export-img");
  const btnPrint = document.getElementById("btn-print");
  const btnExportTrials = document.getElementById("btn-export-trials");
  const exportOptionsBar = document.getElementById("export-options-bar");
  const chkIncTrials = document.getElementById("chk-inc-trials");
  const chkIncOrders = document.getElementById("chk-inc-orders");
  const chkIncScrap = document.getElementById("chk-inc-scrap");

  // --- Theme Management (Default: Midnight dark theme) ---
  const btnThemeToggle = document.getElementById("btn-theme-toggle");
  const themeIconSun = document.getElementById("theme-icon-sun");
  const themeIconMoon = document.getElementById("theme-icon-moon");
  const themeLabel = document.getElementById("theme-label");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rollcut-theme-v2", theme);
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

  const savedTheme = localStorage.getItem("rollcut-theme-v2") || "dark";
  applyTheme(savedTheme);

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // Distinct color palette for cut segments
  const PALETTE = [
    "#0d9488", "#2563eb", "#7c3aed", "#d97706",
    "#0891b2", "#db2777", "#4f46e5", "#16a34a",
    "#ca8a04", "#9333ea", "#0284c7", "#e11d48"
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
        const oid = r.querySelector(".order-id") ? r.querySelector(".order-id").value : "";
        const w   = r.querySelector(".order-width") ? r.querySelector(".order-width").value : "";
        const q   = r.querySelector(".order-qty") ? r.querySelector(".order-qty").value : "";
        const od  = r.querySelector(".order-date") ? r.querySelector(".order-date").value : "";
        const dd  = r.querySelector(".delivery-date") ? r.querySelector(".delivery-date").value : "";
        if (w || q || oid) ordersBackup1D.push({ order_id: oid, width: w, qty: q, order_date: od, delivery_date: dd });
      });
    } else {
      ordersBackup2D = [];
      ordersTbody.querySelectorAll("tr").forEach((r) => {
        const oid = r.querySelector(".order-id") ? r.querySelector(".order-id").value : "";
        const w   = r.querySelector(".order-width") ? r.querySelector(".order-width").value : "";
        const l   = r.querySelector(".order-length") ? r.querySelector(".order-length").value : "";
        const q   = r.querySelector(".order-qty") ? r.querySelector(".order-qty").value : "";
        const od  = r.querySelector(".order-date") ? r.querySelector(".order-date").value : "";
        const dd  = r.querySelector(".delivery-date") ? r.querySelector(".delivery-date").value : "";
        const mat = r.querySelector(".order-material") ? r.querySelector(".order-material").value : "";
        const cust = r.querySelector(".order-customer") ? r.querySelector(".order-customer").value : "";
        const item = r.querySelector(".order-item") ? r.querySelector(".order-item").value : "";
        if (w || l || q || oid) ordersBackup2D.push({ order_id: oid, width: w, length: l, qty: q, order_date: od, delivery_date: dd, material: mat, customer: cust, item });
      });
    }

    currentMode = mode;

    // The manufacture panel belongs to the previous mode's plan
    document.querySelectorAll(".unfulfilled-panel, .unfulfilled-plan-notice").forEach((el) => el.remove());

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
      if (inputNewRollMat) inputNewRollMat.style.display = "none";
      if (inputNewRollGsm) inputNewRollGsm.style.display = "none";
      if (thOrderMat) thOrderMat.style.display = "none";
      if (thOrderCust) thOrderCust.style.display = "none";
      if (thOrderItem) thOrderItem.style.display = "none";
      // Hide Roll ID input in 1D mode
      if (inputNewRollId) {
        inputNewRollId.style.display = "none";
        inputNewRollId.value = "";
      }
      if (inputNewRollQty) inputNewRollQty.placeholder = "Stock Qty (∞)";
      if (orderPanelNote) orderPanelNote.textContent = "Cut widths and required quantities";
      if (thOrderId) { thOrderId.style.display = ""; thOrderId.style.width = "100px"; }
      if (thOrderW) thOrderW.style.width = "120px";
      if (thOrderL) thOrderL.style.display = "none";
      if (thOrderQ) {
        thOrderQ.style.width = "80px";
        thOrderQ.textContent = "Qty";
      }
      if (thOrderDate) { thOrderDate.style.display = ""; thOrderDate.style.width = "140px"; }
      if (thOrderDel) { thOrderDel.style.display = ""; thOrderDel.style.width = "140px"; }

      // Restore 1D orders
      ordersTbody.innerHTML = "";
      if (ordersBackup1D.length > 0) {
        ordersBackup1D.forEach((item) => createOrderRow(item.width, item.qty, "", item.order_id, item.order_date, item.delivery_date));
      } else {
        createOrderRow();
      }

      renderRollChips();
      updateDemandCalculation();

      if (latestPlanData) {
        renderPlanResults(latestPlanData);
        if (document.getElementById("btn-view-plan")) {
          document.getElementById("btn-view-plan").style.display = "block";
        }
      } else {
        emptyState.style.display = "flex";
        planContainer.style.display = "none";
        kpiSection.style.display = "none";
        planStatusNote.textContent = "Awaiting calculation";
        if (btnCancelPlan) btnCancelPlan.style.display = "none";
        btnExportImg.style.display = "none";
        btnPrint.style.display = "none";
        if (btnExportTrials) btnExportTrials.style.display = "none";
        if (document.getElementById("btn-view-plan")) {
          document.getElementById("btn-view-plan").style.display = "none";
        }
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
      if (inputNewRollMat) inputNewRollMat.style.display = "block";
      if (inputNewRollGsm) inputNewRollGsm.style.display = "block";
      if (thOrderMat) thOrderMat.style.display = "";
      if (thOrderCust) thOrderCust.style.display = "";
      if (thOrderItem) thOrderItem.style.display = "";
      // Show Roll ID input in 2D mode with clear label
      if (inputNewRollId) {
        inputNewRollId.style.display = "block";
        inputNewRollId.placeholder = "Roll ID (auto: MR-001)";
      }
      if (inputNewRollQty) inputNewRollQty.placeholder = "Stock (∞)";
      if (orderPanelNote) orderPanelNote.textContent = "Cut sizes (width in mm × length in meters) and piece quantities";
      if (thOrderId) { thOrderId.style.display = ""; thOrderId.style.width = "100px"; }
      if (thOrderW) thOrderW.style.width = "110px";
      if (thOrderL) {
        thOrderL.style.display = "";
        thOrderL.style.width = "110px";
        thOrderL.textContent = "Length (m)";
      }
      if (thOrderQ) {
        thOrderQ.style.width = "70px";
        thOrderQ.textContent = "Qty";
      }
      if (thOrderDate) { thOrderDate.style.display = ""; thOrderDate.style.width = "130px"; }
      if (thOrderDel) { thOrderDel.style.display = ""; thOrderDel.style.width = "130px"; }

      // Restore 2D orders
      ordersTbody.innerHTML = "";
      if (ordersBackup2D.length > 0) {
        ordersBackup2D.forEach((item) => createOrderRow(item.width, item.qty, item.length, item.order_id, item.order_date, item.delivery_date, item.material || "", item.customer || "", item.item || ""));
      } else {
        createOrderRow("", "", "");
      }

      renderRollChips();
      updateDemandCalculation();

      if (latestPlanData2D) {
        renderPlanResults2D(latestPlanData2D);
        if (document.getElementById("btn-view-plan")) {
          document.getElementById("btn-view-plan").style.display = "block";
        }
      } else {
        emptyState.style.display = "flex";
        planContainer.style.display = "none";
        kpiSection.style.display = "none";
        planStatusNote.textContent = "Awaiting calculation";
        if (btnCancelPlan) btnCancelPlan.style.display = "none";
        btnExportImg.style.display = "none";
        btnPrint.style.display = "none";
        if (btnExportTrials) btnExportTrials.style.display = "none";
        if (exportOptionsBar) exportOptionsBar.style.display = "none";
        if (document.getElementById("btn-view-plan")) {
          document.getElementById("btn-view-plan").style.display = "none";
        }
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
      const uid = btn.getAttribute("data-roll-uid");
      const exists = masterRolls.some((r) => r.isRemnant && r.sourceRollUid === uid);
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
      if (btn.classList.contains("btn-remnant-consumed") || btn.disabled) return;
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

      // Only leftovers promised by an uncut roll of this plan; leftovers already in stock
      // (e.g. created when an earlier roll was cut) stay in stock
      if (rem.sourceRollUid && uncutUids.has(rem.sourceRollUid)) {
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

  // ── Master roll IDs ─────────────────────────────────────────────────
  // Auto IDs continue the format of the last ID the user typed: "AB-07" → AB-08, AB-09 …
  // (prefix kept, number continues, zero-padding kept). Without a typed ID the format is
  // taken from the inventory, else the default (M1 in 1D, MR-001 in 2D).
  const rollIdFormat = { "1d": null, "2d": null };

  function parseRollIdFormat(id) {
    const m = /^(.*?)(\d+)$/.exec(id || "");
    return m ? { prefix: m[1], pad: m[2].length, num: parseInt(m[2], 10) } : null;
  }

  function rememberRollIdFormat(mode, id) {
    const f = parseRollIdFormat(id);
    // An ID without a trailing number (e.g. "LINE-A") continues as LINE-A-01, LINE-A-02 …
    rollIdFormat[mode] = f ? { prefix: f.prefix, pad: f.pad } : { prefix: `${id}-`, pad: 2 };
  }

  // ID reuse rules:
  //  - A roll that physically exists (real stock, a remnant, or a "To Manufacture" roll that has
  //    been cut) keeps its ID forever. Deleting it retires the ID so it is never handed out again.
  //  - A "To Manufacture" roll that was never cut did not exist yet. Deleting it (or cancelling
  //    its plan) frees the ID, and the next new roll, manual or manufactured, takes the lowest free number.
  const retiredRollIds = { "1d": new Set(), "2d": new Set() };

  function isPhysicalRoll(r) {
    if (!r.isToProduce) return true;
    return (r.consumed_orders && r.consumed_orders.length > 0) || (r.qty !== null && r.qty <= 0);
  }

  function releaseRollIds(mode, removedRolls) {
    removedRolls.forEach((r) => {
      if (r.roll_id && isPhysicalRoll(r)) retiredRollIds[mode].add(r.roll_id);
    });
  }

  function takenRollIds(mode) {
    const taken = new Set(retiredRollIds[mode]);
    (mode === "1d" ? masterRolls : masterRolls2D).forEach((r) => { if (r.roll_id) taken.add(r.roll_id); });
    // IDs printed on the current plan's roll cards stay reserved until that plan is replaced or
    // cancelled, so "Mark as Cut" on an old card can never hit a new roll that reused the ID
    const data = mode === "1d" ? latestPlanData : latestPlanData2D;
    if (data && data.plan) data.plan.forEach((r) => { if (r.master_roll_id) taken.add(r.master_roll_id); });
    return taken;
  }

  function usedRollNumbers(mode, prefix) {
    const used = new Set();
    takenRollIds(mode).forEach((id) => {
      if (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))) used.add(parseInt(id.slice(prefix.length), 10));
    });
    return used;
  }

  function nextRollId(list, mode, fallback) {
    let fmt = rollIdFormat[mode];
    if (!fmt) {
      // Use the format of the highest-numbered non-remnant roll already in inventory
      let best = null;
      list.forEach((r) => {
        if (r.isRemnant || /-R\d+$/.test(r.roll_id || "")) return;
        const f = parseRollIdFormat(r.roll_id);
        if (f && (!best || f.num > best.num)) best = f;
      });
      fmt = best || fallback;
    }
    // Lowest free number, so IDs freed by deleted (never-cut) rolls are filled first
    const used = usedRollNumbers(mode, fmt.prefix);
    let n = 1;
    while (used.has(n)) n++;
    return fmt.prefix + String(n).padStart(fmt.pad, "0");
  }

  function generateNextMasterRollId() {
    return nextRollId(masterRolls, "1d", { prefix: "M", pad: 1 });
  }

  // Remnant IDs trace back to the parent master roll: MR-010 -> MR-010-R1, MR-010-R2 ...
  // (a remnant of a remnant stays under the same parent: MR-010-R1 -> MR-010-R2)
  function generateRemnantRollId2D(parentId) {
    if (!parentId) return generateNextMasterRollId2D();
    const base = parentId.replace(/(-R\d+)+$/, "");
    const used = new Set();
    const prefix = `${base}-R`;
    const collect = (id) => {
      if (id && id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))) {
        used.add(parseInt(id.slice(prefix.length), 10));
      }
    };
    masterRolls2D.forEach((r) => collect(r.roll_id));
    retiredRollIds["2d"].forEach(collect);
    if (latestPlanData2D && latestPlanData2D.plan) latestPlanData2D.plan.forEach((r) => collect(r.master_roll_id));
    let n = 1;
    while (used.has(n)) n++;
    return `${base}-R${n}`;
  }

  function generateNextMasterRollId2D() {
    return nextRollId(masterRolls2D, "2d", { prefix: "MR-", pad: 3 });
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
        // A "To Manufacture" roll that has been cut is already made → no longer pending manufacture
        const isProduced = item.isToProduce && item.qty !== null && item.qty <= 0;
        const isPendingMfg = item.isToProduce && !isProduced;
        chip.className = `chip ${isRemnant ? "chip-remnant" : ""} ${isPendingMfg ? "chip-to-produce" : ""}`;
        let stockStr;
        if (item.isToProduce) {
          stockStr = isProduced ? "0 in stock" : "To Manufacture (Not in stock)";
        } else {
          stockStr = item.qty === null ? "∞ stock" : `${item.qty} in stock`;
        }
        const stockZeroClass = item.qty !== null && item.qty <= 0 ? "chip-stock-zero" : (item.isToProduce ? "chip-stock-toproduce" : "");
        const rollIdLabel = item.roll_id ? `<span class="chip-roll-id">${item.roll_id}</span>` : '';
        const produceBadge = isProduced
          ? '<span class="chip-badge-produced" title="Manufactured for this plan and cut">✓ Manufactured</span>'
          : (isPendingMfg ? '<span class="chip-badge-to-produce">⚙ To Manufacture</span>' : '');
        
        // Check if there are consumed orders for this master roll (from cutting plan)
        const consumed = item.consumed_orders && item.consumed_orders.length > 0 ? item.consumed_orders : [];
        const hasConsumed = consumed.length > 0;

        let consumedToggleHtml = '';
        let consumedDrawerHtml = '';
        let distinctCount = 0;
        if (hasConsumed) {
          const groupedMap = new Map();
          consumed.forEach(c => {
            const key = `${c.order_id || '—'}||${c.width}`;
            if (!groupedMap.has(key)) {
              groupedMap.set(key, {
                order_id: c.order_id || '—',
                width: c.width,
                qty: 0,
                order_date: c.order_date || '—',
                delivery_date: c.delivery_date || '—'
              });
            }
            groupedMap.get(key).qty += c.qty;
          });
          const groupedList = Array.from(groupedMap.values());
          distinctCount = groupedList.length;

          const rows = groupedList.map(c => `
            <tr>
              <td><span class="manifest-order-tag">${c.order_id}</span></td>
              <td><strong>${c.width}mm</strong> &times; ${c.qty}</td>
              <td>${c.order_date}</td>
              <td>${c.delivery_date}</td>
            </tr>
          `).join('');

          consumedToggleHtml = `
            <button type="button" class="chip-btn-consumed" title="View customer orders consumed in this master roll">
              <span>Orders (${distinctCount})</span> ▾
            </button>
          `;

          consumedDrawerHtml = `
            <div class="chip-consumed-drawer">
              <table>
                <thead>
                  <tr><th>Order ID</th><th>Cut</th><th>Order Date</th><th>Delivery Date</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
        }

        chip.innerHTML = `
          <div class="chip-item-wrapper" style="width: 100%;">
            <div class="chip-main-row">
              ${rollIdLabel}
              <span>${item.width.toLocaleString()} mm</span>
              <span class="chip-stock ${stockZeroClass}">${stockStr}</span>
              ${isRemnant ? '<span class="chip-badge-remnant">Leftover</span>' : ''}
              ${produceBadge}
              ${consumedToggleHtml}
              <span class="chip-remove" title="Remove size" data-id="${item.id || item.width}">&times;</span>
            </div>
            ${consumedDrawerHtml}
          </div>
        `;

        if (hasConsumed) {
          const btnTog = chip.querySelector(".chip-btn-consumed");
          const drw = chip.querySelector(".chip-consumed-drawer");
          if (btnTog && drw) {
            btnTog.addEventListener("click", (e) => {
              e.stopPropagation();
              drw.classList.toggle("open");
              const isOpen = drw.classList.contains("open");
              btnTog.innerHTML = `<span>Orders (${distinctCount})</span> ${isOpen ? '▴' : '▾'}`;
            });
          }
        }

        chip.querySelector(".chip-remove").addEventListener("click", (e) => {
          e.stopPropagation();
          releaseRollIds("1d", [item]);
          masterRolls = masterRolls.filter((r) => r !== item);
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
      // Sort by ID: MR-NNN numerically, then other manual IDs, then remnants / no ID
      const idRank = (r) => {
        if (r.isRemnant || !r.roll_id) return [2, 0, r.roll_id || ""];
        const m = /^MR-(\d+)$/.exec(r.roll_id);
        return m ? [0, parseInt(m[1], 10), ""] : [1, 0, r.roll_id];
      };
      masterRolls2D.sort((a, b) => {
        const ra = idRank(a), rb = idRank(b);
        return (ra[0] - rb[0]) || (ra[1] - rb[1]) || ra[2].localeCompare(rb[2], undefined, { numeric: true });
      });
      masterRolls2D.forEach((item) => {
        const chipKey = `${item.width}_${item.length}`;
        const isRemnant = item.isRemnant || remnantRollSizes2D.has(chipKey);
        const chip = document.createElement("div");
        // A "To Manufacture" roll that has been cut is already made → no longer pending manufacture
        const isProduced = item.isToProduce && item.qty !== null && item.qty <= 0;
        const isPendingMfg = item.isToProduce && !isProduced;
        chip.className = `chip ${isRemnant ? "chip-remnant" : ""} ${isPendingMfg ? "chip-to-produce" : ""}`;
        let stockStr;
        if (item.isToProduce) {
          stockStr = isProduced ? "0 in stock" : "To Manufacture (Not in stock)";
        } else {
          stockStr = item.qty === null ? "∞ stock" : `${item.qty} in stock`;
        }
        const stockZeroClass = item.qty !== null && item.qty <= 0 ? "chip-stock-zero" : (item.isToProduce ? "chip-stock-toproduce" : "");
        const rollIdLabel = item.roll_id ? `<span class="chip-roll-id">${item.roll_id}</span>` : '';
        const produceBadge = isProduced
          ? '<span class="chip-badge-produced" title="Manufactured for this plan and cut">✓ Manufactured</span>'
          : (isPendingMfg ? '<span class="chip-badge-to-produce">⚙ To Manufacture</span>' : '');
        
        // Check if there are consumed orders for this 2D master roll
        const consumed = item.consumed_orders && item.consumed_orders.length > 0 ? item.consumed_orders : [];
        const hasConsumed = consumed.length > 0;

        let consumedToggleHtml = '';
        let consumedDrawerHtml = '';
        let distinctCount = 0;
        if (hasConsumed) {
          const groupedMap = new Map();
          consumed.forEach(c => {
            const key = `${c.order_id || '—'}||${c.item || ''}||${c.width}||${c.length}`;
            if (!groupedMap.has(key)) {
              groupedMap.set(key, {
                order_id: c.order_id || '—',
                item: c.item || '',
                customer: c.customer || '—',
                material: c.material || item.material || '—',
                width: c.width,
                length: c.length,
                qty: 0,
                order_date: c.order_date || '—',
                delivery_date: c.delivery_date || '—'
              });
            }
            groupedMap.get(key).qty += c.qty;
          });
          const groupedList = Array.from(groupedMap.values());
          distinctCount = groupedList.length;

          const rows = groupedList.map(c => `
            <tr>
              <td><span class="manifest-order-tag">${orderRef(c)}</span></td>
              <td>${c.customer}</td>
              <td>${c.material}</td>
              <td><strong>${c.width}mm &times; ${c.length}m</strong> &times; ${c.qty}</td>
              <td>${c.order_date}</td>
              <td>${c.delivery_date}</td>
            </tr>
          `).join('');

          consumedToggleHtml = `
            <button type="button" class="chip-btn-consumed" title="View customer orders consumed in this master roll">
              <span>Orders (${distinctCount})</span> ▾
            </button>
          `;

          consumedDrawerHtml = `
            <div class="chip-consumed-drawer">
              <table>
                <thead>
                  <tr><th>Order ID</th><th>Customer</th><th>Material</th><th>Cut</th><th>Order Date</th><th>Delivery Date</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
        }

        chip.innerHTML = `
          <div class="chip-item-wrapper" style="width: 100%;">
            <div class="chip-main-row">
              ${rollIdLabel}
              <span>${item.width.toLocaleString()} mm &times; ${item.length.toLocaleString()} m</span>
              ${item.material || item.gsm ? `<span class="chip-material" title="Material code · grammage">${item.material || "—"}${item.gsm ? ` · ${item.gsm} gsm` : ""}</span>` : ""}
              <span class="chip-stock ${stockZeroClass}">${stockStr}</span>
              ${isRemnant ? '<span class="chip-badge-remnant">Leftover</span>' : ''}
              ${produceBadge}
              ${consumedToggleHtml}
              <span class="chip-remove" title="Remove size">&times;</span>
            </div>
            ${consumedDrawerHtml}
          </div>
        `;

        if (hasConsumed) {
          const btnTog = chip.querySelector(".chip-btn-consumed");
          const drw = chip.querySelector(".chip-consumed-drawer");
          if (btnTog && drw) {
            btnTog.addEventListener("click", (e) => {
              e.stopPropagation();
              drw.classList.toggle("open");
              const isOpen = drw.classList.contains("open");
              btnTog.innerHTML = `<span>Orders (${distinctCount})</span> ${isOpen ? '▴' : '▾'}`;
            });
          }
        }

        chip.querySelector(".chip-remove").addEventListener("click", (e) => {
          e.stopPropagation();
          releaseRollIds("2d", [item]);
          masterRolls2D = masterRolls2D.filter((r) => r !== item);
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
    const enteredRollId = inputNewRollId ? inputNewRollId.value.trim() : "";
    const qStr = inputNewRollQty && inputNewRollQty.value.trim() !== "" ? inputNewRollQty.value.trim() : "";
    const qtyVal = qStr !== "" ? parseInt(qStr, 10) : null;
    if (qtyVal !== null && qtyVal < 0) {
      showError("Stock quantity cannot be negative.");
      return;
    }

    if (enteredRollId) rememberRollIdFormat(currentMode, enteredRollId);

    if (currentMode === "1d") {
      if (enteredRollId) {
        const existing = masterRolls.find((r) => r.roll_id === enteredRollId);
        if (existing) {
          existing.width = val;
          existing.qty = qtyVal;
        } else {
          masterRolls.push({
            id: `mr_1d_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            roll_id: enteredRollId,
            width: val,
            qty: qtyVal !== null ? qtyVal : null,
            isRemnant: false,
            consumed_orders: []
          });
        }
      } else if (qtyVal !== null && qtyVal > 1) {
        // Create individual master rolls each with unique ID so each physical roll has its own ID
        for (let i = 0; i < qtyVal; i++) {
          masterRolls.push({
            id: `mr_1d_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            roll_id: generateNextMasterRollId(),
            width: val,
            qty: 1,
            isRemnant: false,
            consumed_orders: []
          });
        }
      } else {
        masterRolls.push({
          id: `mr_1d_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          roll_id: generateNextMasterRollId(),
          width: val,
          qty: qtyVal,
          isRemnant: false,
          consumed_orders: []
        });
      }
    } else {
      // 2D Mode
      const lenVal = inputNewRollLen ? parseInt(inputNewRollLen.value.trim(), 10) : 0;
      if (!lenVal || lenVal <= 0) {
        showError("Please enter a valid positive roll length in meters (m).");
        return;
      }
      // Material code and GSM stay filled in, so several rolls of one material can be added quickly
      const mat = normMat(inputNewRollMat ? inputNewRollMat.value : "");
      const gsmVal = inputNewRollGsm ? parseFloat(inputNewRollGsm.value) : NaN;
      const gsm = gsmVal > 0 ? gsmVal : null;
      if (enteredRollId) {
        // Manual ID: if qty > 1, the typed ID is the first roll and the number continues
        // (AB-05 ×3 → AB-05, AB-06, AB-07), skipping numbers already in use
        const qtyToCreate = (qtyVal !== null && qtyVal > 1) ? qtyVal : 1;
        const fmt = parseRollIdFormat(enteredRollId);
        const used = fmt ? usedRollNumbers("2d", fmt.prefix) : new Set();
        let nextNum = fmt ? fmt.num : 0;
        for (let i = 0; i < qtyToCreate; i++) {
          let rollId;
          if (i === 0) rollId = enteredRollId;
          else if (fmt) {
            do { nextNum++; } while (used.has(nextNum));
            rollId = fmt.prefix + String(nextNum).padStart(fmt.pad, "0");
          } else rollId = `${enteredRollId}-${String(i + 1).padStart(2, "0")}`;
          masterRolls2D.push({
            id: `mr_2d_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            roll_id: rollId,
            width: val,
            length: lenVal,
            material: mat,
            gsm,
            qty: 1,
            isRemnant: false,
            consumed_orders: []
          });
        }
      } else if (qtyVal !== null && qtyVal >= 1) {
        // Auto ID: create individual rolls each with auto-incremented MR-xxx ID
        for (let i = 0; i < qtyVal; i++) {
          masterRolls2D.push({
            id: `mr_2d_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            roll_id: generateNextMasterRollId2D(),
            width: val,
            length: lenVal,
            material: mat,
            gsm,
            qty: 1,
            isRemnant: false,
            consumed_orders: []
          });
        }
      } else {
        // No qty specified — single roll with auto ID
        masterRolls2D.push({
          id: `mr_2d_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          roll_id: generateNextMasterRollId2D(),
          width: val,
          length: lenVal,
            material: mat,
            gsm,
          qty: 1,
          isRemnant: false,
          consumed_orders: []
        });
      }
      if (inputNewRollLen) inputNewRollLen.value = "";
    }

    clearError();
    if (inputNewRollId) inputNewRollId.value = "";
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
        releaseRollIds("1d", masterRolls);
        masterRolls = [];
        remnantRollSizes.clear();
      } else {
        releaseRollIds("2d", masterRolls2D);
        masterRolls2D = [];
        remnantRollSizes2D.clear();
      }
      renderRollChips();
    });
  }

  // ===================================================================
  // Order Table Management
  // ===================================================================
  function createOrderRow(width = "", qty = "", length = "", orderId = "", orderDate = "", deliveryDate = "", material = "", customer = "", item = "") {
    const tr = document.createElement("tr");
    const itemCell = `
      <td>
        <input type="number" class="order-item" placeholder="auto" value="${item}" min="1" step="10" title="Line item within the order (10, 20, 30 …). Filled automatically if left blank." style="width:100%;">
      </td>
    `;
    const customerCell = `
      <td>
        <input type="text" class="order-customer" placeholder="Customer" value="${String(customer).replace(/"/g, "&quot;")}" title="Customer name" style="width:100%;">
      </td>
    `;
    const materialCell = `
      <td>
        <input type="text" class="order-material" placeholder="Material" value="${String(material).replace(/"/g, "&quot;")}" title="Material code — must match a master roll's material" style="width:100%;">
      </td>
    `;

    const sharedIdCell = `
      <td>
        <input type="text" class="order-id" placeholder="Order ID" value="${orderId}" style="width:100%;">
      </td>
    `;
    const sharedDateCells = `
      <td>
        <input type="date" class="order-date" value="${orderDate}" title="Order Date" style="width:100%;">
      </td>
      <td>
        <input type="date" class="delivery-date" value="${deliveryDate}" title="Delivery Date" style="width:100%;">
      </td>
    `;

    if (currentMode === "1d") {
      tr.innerHTML = `
        ${sharedIdCell}
        <td>
          <input type="number" class="order-width" placeholder="Width (mm)" value="${width}" min="1" step="1">
        </td>
        <td>
          <input type="number" class="order-qty" placeholder="Qty" value="${qty}" min="1" step="1">
        </td>
        ${sharedDateCells}
        <td style="text-align: center;">
          <button type="button" class="btn btn-text danger btn-sm btn-delete-row" title="Delete line">&times;</button>
        </td>
      `;
    } else {
      tr.innerHTML = `
        ${sharedIdCell}
        ${itemCell}
        ${customerCell}
        ${materialCell}
        <td>
          <input type="number" class="order-width" placeholder="Width (mm)" value="${width}" min="1" step="1">
        </td>
        <td class="td-order-len">
          <input type="number" class="order-length" placeholder="Length (m)" value="${length}" min="1" step="1">
        </td>
        <td>
          <input type="number" class="order-qty" placeholder="Qty" value="${qty}" min="1" step="1">
        </td>
        ${sharedDateCells}
        <td style="text-align: center;">
          <button type="button" class="btn btn-text danger btn-sm btn-delete-row" title="Delete line">&times;</button>
        </td>
      `;
    }

    const wInput = tr.querySelector(".order-width");
    const lInput = tr.querySelector(".order-length");
    const qInput = tr.querySelector(".order-qty");
    const delBtn = tr.querySelector(".btn-delete-row");
    const idInput = tr.querySelector(".order-id");
    if (idInput && tr.querySelector(".order-item")) idInput.addEventListener("change", () => assignItemNumbers());

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
      demandCounter.textContent = `Total Demand: ${areaM2} m² (${totalRolls} pieces)`;
    }
  }

  /**
   * Adjust order-table row quantities by `delta` for each cut on a roll.
   * delta = -1  → deduct (roll marked as cut)
   * delta = +1  → restore (undo)
   */
  // ── Order traceability ──────────────────────────────────────────────
  // The Customer Demand table always holds the REMAINING demand per order row.
  // Cutting a roll deducts exactly the pieces labelled to each order on that roll;
  // undo puts the same pieces back on the same order rows (ID + dates kept).

  function orderKey(mode, width, length) {
    return mode === "1d" ? String(width) : `${width}_${length}`;
  }

  // Split a 2D run's waste into its two sources:
  //  - side trim: unused width across the full run length
  //  - length tail: pieces shorter than the run length leave an unused tail on their lanes
  // waste_area_pct from the solver is the sum of both.
  // Per-roll pill: run yield = pieces ÷ area actually slit. The rest of the slit area is
  // split into scrap and reusable side offcuts (>= 150 mm, offered back to stock).
  function rollYieldText(roll, sep) {
    const slitArea = roll.master_width * roll.length_used;
    const offcutPct = slitArea ? ((roll.total_width_remnant_area || 0) / slitArea) * 100 : 0;
    const restPct = Math.max(0, 100 - roll.slitting_eff_pct);
    const scrapPct = Math.max(0, restPct - offcutPct);
    return `${roll.slitting_eff_pct}% Run Yield${sep}${scrapPct.toFixed(2)}% Scrap` +
      (offcutPct >= 0.005 ? `${sep}${offcutPct.toFixed(2)}% Reusable Offcut` : "");
  }

  function runWasteBreakdown(sec, masterWidth) {
    const totalPct = Number(sec.waste_area_pct) || 0;
    const trimPct = masterWidth > 0 ? (sec.width_waste_mm / masterWidth) * 100 : 0;
    const tailPct = Math.max(0, totalPct - trimPct);
    return { trimPct: trimPct.toFixed(2), tailPct: tailPct.toFixed(2), totalPct: totalPct.toFixed(2), hasTail: tailPct >= 0.005 };
  }

  // Sort the demand table by Order ID (natural order), then width, then length, so rows
  // restored by an undo land next to the rest of their order instead of at the bottom.
  function sortOrderRows() {
    const rowKey = (r) => {
      const oid = (r.querySelector(".order-id") || {}).value || "";
      const w = parseInt((r.querySelector(".order-width") || {}).value, 10) || 0;
      const l = parseInt((r.querySelector(".order-length") || {}).value, 10) || 0;
      const item = parseInt((r.querySelector(".order-item") || {}).value, 10) || 0;
      return { oid: oid.trim(), item, w, l, empty: !oid.trim() && !w };
    };
    const rows = Array.from(ordersTbody.querySelectorAll("tr")).map((r) => ({ r, k: rowKey(r) }));
    rows.sort((a, b) => {
      if (a.k.empty !== b.k.empty) return a.k.empty ? 1 : -1; // blank rows stay at the bottom
      if (!a.k.oid !== !b.k.oid) return a.k.oid ? -1 : 1;     // rows without an ID after rows with one
      return a.k.oid.localeCompare(b.k.oid, undefined, { numeric: true }) || (a.k.item - b.k.item) || (a.k.w - b.k.w) || (a.k.l - b.k.l);
    });
    rows.forEach(({ r }) => ordersTbody.appendChild(r));
  }

  // Apply a roll's per-order assignments to the demand table.
  // assignments: [{order_id, width, length?, qty, order_date, delivery_date}], delta: -1 cut / +1 undo or defect
  function adjustOrderQty(assignments, delta) {
    let rowsRestored = false;
    assignments.forEach((a) => {
      const oid = a.order_id && a.order_id !== "—" ? a.order_id : "";
      let qty = a.qty;
      if (!qty) return;
      const matches = Array.from(ordersTbody.querySelectorAll("tr")).filter((r) => {
        const oidInput = r.querySelector(".order-id");
        const wInput   = r.querySelector(".order-width");
        const lInput   = r.querySelector(".order-length");
        const rowOid = oidInput ? oidInput.value.trim() : "";
        const rowW   = wInput ? parseInt(wInput.value, 10) : 0;
        const rowL   = lInput ? parseInt(lInput.value, 10) : 0;
        const matInput = r.querySelector(".order-material");
        const dimMatch = currentMode === "1d"
          ? rowW === a.width
          : (rowW === a.width && rowL === a.length && normMat(matInput ? matInput.value : "") === normMat(a.material));
        const itemInput = r.querySelector(".order-item");
        const itemMatch = !a.item || !itemInput || !itemInput.value || parseInt(itemInput.value, 10) === parseInt(a.item, 10);
        return dimMatch && rowOid === oid && itemMatch;
      });

      if (delta < 0) {
        // Deduct only from this order's row(s) — never from other orders of the same size
        for (const r of matches) {
          if (qty <= 0) break;
          const qInput = r.querySelector(".order-qty");
          const have = parseInt(qInput.value, 10) || 0;
          const t = Math.min(have, qty);
          qty -= t;
          if (have - t <= 0) r.remove();
          else qInput.value = have - t;
        }
        if (qty > 0) console.warn(`Order ${oid || "(no ID)"}: ${qty} cut piece(s) of ${a.width}${a.length ? "×" + a.length : ""} exceed remaining demand`);
      } else if (matches.length > 0) {
        const qInput = matches[0].querySelector(".order-qty");
        qInput.value = (parseInt(qInput.value, 10) || 0) + qty;
      } else {
        createOrderRow(a.width, qty, currentMode === "1d" ? "" : a.length, oid, a.order_date || "", a.delivery_date || "", a.material || "", a.customer || "", a.item || "");
        rowsRestored = true;
      }
    });
    if (rowsRestored) sortOrderRows();
    if (ordersTbody.children.length === 0) createOrderRow();
    updateDemandCalculation();
  }

  // "O1/20" when the line item is known, else just the Order ID
  const orderRef = (a) => (a && a.item ? `${a.order_id}/${a.item}` : (a ? a.order_id : "—"));

  // ── SAP-style order lines ─────────────────────────────────────────────
  // Each table row is one line item of its order: 10, 20, 30 … in table order.
  // Numbers are stored on the row, so they stay the same when rows are cut / restored.
  function assignItemNumbers() {
    const rows = Array.from(ordersTbody.querySelectorAll("tr"));
    const used = {};
    rows.forEach((r) => {
      const oid = (r.querySelector(".order-id") || {}).value?.trim();
      const it = parseInt((r.querySelector(".order-item") || {}).value, 10);
      if (oid && it > 0) (used[oid] = used[oid] || new Set()).add(it);
    });
    rows.forEach((r) => {
      const idIn = r.querySelector(".order-id"), itIn = r.querySelector(".order-item");
      const oid = idIn ? idIn.value.trim() : "";
      if (!itIn || !oid || parseInt(itIn.value, 10) > 0) return;
      const set = used[oid] = used[oid] || new Set();
      let n = set.size ? Math.max(...set) + 10 : 10;
      n = Math.ceil(n / 10) * 10;
      set.add(n);
      itIn.value = n;
    });
  }

  // One Order ID → one customer; no item number twice in the same order
  function checkOrderIds() {
    const problems = [];
    const cust = {}, items = {};
    ordersTbody.querySelectorAll("tr").forEach((r) => {
      const g = (c) => (r.querySelector(c) ? r.querySelector(c).value.trim() : "");
      const oid = g(".order-id");
      if (!oid || !(parseInt(g(".order-qty"), 10) > 0)) return;
      const c = g(".order-customer");
      if (c) (cust[oid] = cust[oid] || new Set()).add(c.toUpperCase());
      const it = g(".order-item");
      if (it) {
        const k = `${oid}/${it}`;
        items[k] = (items[k] || 0) + 1;
      }
    });
    Object.entries(cust).forEach(([oid, set]) => {
      if (set.size > 1) problems.push(`Order ${oid} has more than one customer (${[...set].join(", ")}). Each order belongs to one customer — use a different Order ID.`);
    });
    Object.entries(items).forEach(([k, n]) => {
      if (n > 1) problems.push(`Item ${k} is used on ${n} rows. Each line of an order needs its own item number.`);
    });
    return problems;
  }

  // Delivery urgency → weight per piece for the solver (earlier date = higher weight).
  // Undated orders weigh 1; dated orders 2..10 by how early they are due vs. the others.
  function deliveryPriority(lines) {
    const due = (o) => (o.delivery_date ? Date.parse(o.delivery_date) : NaN);
    const dated = lines.map(due).filter((x) => !isNaN(x));
    if (dated.length === 0) return [];
    const min = Math.min(...dated), max = Math.max(...dated);
    const bySize = {};
    lines.forEach((o) => {
      const d = due(o);
      const w = isNaN(d) ? 1 : (max === min ? 10 : 2 + (8 * (max - d)) / (max - min));
      const k = `${o.width}_${o.length}`;
      if (!bySize[k]) bySize[k] = { width: o.width, length: o.length, weights: [] };
      for (let i = 0; i < o.quantity; i++) bySize[k].weights.push(Math.round(w * 100) / 100);
    });
    return Object.values(bySize);
  }

  // Pool key: size, plus material in 2D (pieces only go to orders of the roll's material)
  function poolKey(mode, mat, w, l) {
    return mode === "2d" ? `${normMat(mat)}|${orderKey(mode, w, l)}` : orderKey(mode, w, l);
  }

  // Remaining demand per order row, read from the table, grouped by size key (table order = FIFO order)
  function readOrderPool(mode) {
    const pool = {};
    ordersTbody.querySelectorAll("tr").forEach((r) => {
      const oidInput = r.querySelector(".order-id");
      const wInput   = r.querySelector(".order-width");
      const lInput   = r.querySelector(".order-length");
      const qInput   = r.querySelector(".order-qty");
      const odInput  = r.querySelector(".order-date");
      const ddInput  = r.querySelector(".delivery-date");
      const matInput = r.querySelector(".order-material");
      const w = wInput ? parseInt(wInput.value, 10) : 0;
      const l = lInput ? parseInt(lInput.value, 10) : 0;
      const q = qInput ? parseInt(qInput.value, 10) : 0;
      if (!(w > 0 && q > 0) || (mode === "2d" && !(l > 0))) return;
      const mat = normMat(matInput ? matInput.value : "");
      const key = poolKey(mode, mat, w, l);
      if (!pool[key]) pool[key] = [];
      const custInput = r.querySelector(".order-customer");
      const itemInput = r.querySelector(".order-item");
      pool[key].push({
        item: itemInput && itemInput.value ? parseInt(itemInput.value, 10) : "",
        customer: custInput ? custInput.value.trim() : "",
        material: mat,
        order_id: (oidInput && oidInput.value.trim()) || "—",
        order_date: odInput ? odInput.value : "",
        delivery_date: ddInput ? ddInput.value : "",
        rem: q
      });
    });
    // Earliest delivery date gets pieces first (no date = last); ties keep table order
    const due = (e) => (e.delivery_date ? Date.parse(e.delivery_date) : Infinity);
    Object.values(pool).forEach((list) => list.sort((a, b) => due(a) - due(b)));
    return pool;
  }

  // Label every piece on every UNCUT roll with the order it belongs to.
  //  - Cut rolls keep the labels frozen at cut time (their pieces are already deducted from the table).
  //  - Uncut rolls first keep their previous labels where that order still has demand (stable IDs across
  //    re-renders and undo), then the rest is filled FIFO in table order. "—" = no order row left.
  // 1D labels per roll; 2D labels per run (sec._consumedAssignments) and aggregates per roll.
  function allocateOrderIds(plan, mode, completedSet) {
    const pool = readOrderPool(mode);
    const units = [];
    plan.forEach((roll) => {
      if (completedSet.has(roll.uid) && roll._consumedAssignments) return;
      if (mode === "1d") {
        units.push({ roll, holder: roll, runIdx: null, cuts: roll.cuts_summary || [] });
      } else {
        roll.sections.forEach((sec, i) => units.push({ roll, holder: sec, runIdx: i + 1, cuts: sec.cuts || [] }));
      }
    });

    const need = units.map((u) => u.cuts.map((c) => c.quantity));
    const out = units.map(() => []);
    const makeItem = (u, c, entry, qty) => {
      const item = {
        order_id: entry ? entry.order_id : "—",
        customer: entry ? entry.customer || "" : "",
        item: entry ? entry.item || "" : "",
        order_date: entry ? entry.order_date : "",
        delivery_date: entry ? entry.delivery_date : "",
        qty,
        width: c.width,
        roll_num: u.roll.roll_num
      };
      if (mode === "2d") { item.length = c.length; item.run_idx = u.runIdx; item.material = normMat(u.roll.material); }
      return item;
    };
    const addTo = (ui, item) => {
      const same = out[ui].find((x) => x.order_id === item.order_id && x.item === item.item && x.width === item.width && x.length === item.length);
      if (same) same.qty += item.qty;
      else out[ui].push(item);
    };

    // Pass 1: keep previous labels where still valid
    units.forEach((u, ui) => {
      (u.holder._consumedAssignments || []).forEach((prev) => {
        if (!prev.order_id || prev.order_id === "—") return;
        const ci = u.cuts.findIndex((c) => c.width === prev.width && (mode === "1d" || c.length === prev.length));
        if (ci < 0 || need[ui][ci] <= 0) return;
        const entry = (pool[poolKey(mode, u.roll.material, prev.width, prev.length)] || []).find((e) => e.order_id === prev.order_id && (!prev.item || e.item === prev.item) && e.rem > 0);
        if (!entry) return;
        const t = Math.min(entry.rem, prev.qty, need[ui][ci]);
        entry.rem -= t;
        need[ui][ci] -= t;
        addTo(ui, makeItem(u, u.cuts[ci], entry, t));
      });
    });

    // Pass 2: FIFO for everything still unlabelled
    units.forEach((u, ui) => {
      u.cuts.forEach((c, ci) => {
        for (const entry of pool[poolKey(mode, u.roll.material, c.width, c.length)] || []) {
          if (need[ui][ci] <= 0) break;
          if (entry.rem <= 0) continue;
          const t = Math.min(entry.rem, need[ui][ci]);
          entry.rem -= t;
          need[ui][ci] -= t;
          addTo(ui, makeItem(u, c, entry, t));
        }
        if (need[ui][ci] > 0) addTo(ui, makeItem(u, c, null, need[ui][ci]));
      });
    });

    // Write back
    const touched = new Set(units.map((u) => u.roll));
    touched.forEach((roll) => { roll._consumedAssignments = []; });
    units.forEach((u, ui) => {
      if (mode === "2d") u.holder._consumedAssignments = out[ui];
      u.roll._consumedAssignments.push(...out[ui]);
    });
  }

  btnAddOrderRow.addEventListener("click", () => createOrderRow());

  btnClearOrders.addEventListener("click", () => {
    ordersTbody.innerHTML = "";
    document.querySelectorAll(".unfulfilled-panel, .unfulfilled-plan-notice").forEach((el) => el.remove());
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

    if (/\.(xlsx|xls)$/i.test(file.name)) {
      showError("Excel files can't be read directly. In Excel use File → Save As → CSV, then import the .csv file.");
      csvFileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result.replace(/^﻿/, "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length === 0) {
        showError("The CSV file is empty.");
        csvFileInput.value = "";
        return;
      }

      // Detect delimiter (comma, semicolon or tab) from the first line
      const first = lines[0];
      const delim = [",", ";", "\t"].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ",");
      const splitLine = (line) => line.split(delim).map((s) => s.trim().replace(/^"(.*)"$/, "$1").trim());

      // Map columns by header name when a header row is present
      const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, "");
      const headerAliases = {
        orderId: ["orderid", "id", "order", "orderno", "ordernumber"],
        material: ["material", "materialcode", "mat", "grade"],
        customer: ["customer", "customername", "client", "party", "soldto"],
        item: ["item", "itemno", "itemnumber", "line", "lineitem", "posnr"],
        width: ["width", "w", "widthmm"],
        length: ["length", "l", "len", "lengthm"],
        qty: ["qty", "quantity", "q", "rolls", "pieces"],
        orderDate: ["orderdate"],
        deliveryDate: ["deliverydate", "duedate", "delivery"]
      };
      const headerCells = splitLine(first).map(norm);
      const cols = {};
      Object.entries(headerAliases).forEach(([key, aliases]) => {
        const idx = headerCells.findIndex((h) => aliases.includes(h));
        if (idx >= 0) cols[key] = idx;
      });
      const hasHeader = cols.width !== undefined && cols.qty !== undefined;
      const dataLines = hasHeader ? lines.slice(1) : lines;

      // Convert dd-mm-yyyy / dd/mm/yyyy to yyyy-mm-dd for date inputs
      const toIsoDate = (v) => {
        if (!v) return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
      };
      const escapeAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

      ordersTbody.innerHTML = "";
      let count = 0;

      dataLines.forEach((line) => {
        let parts = splitLine(line);
        let c = cols;
        if (!hasHeader) {
          // No header: optional leading non-numeric Order ID, then width, [length], qty
          const offset = parts.length > 0 && isNaN(parseInt(parts[0], 10)) ? 1 : 0;
          c = currentMode === "1d"
            ? { orderId: offset ? 0 : undefined, width: offset, qty: offset + 1 }
            : (parts.length - offset >= 3
                ? { orderId: offset ? 0 : undefined, width: offset, length: offset + 1, qty: offset + 2 }
                : { orderId: offset ? 0 : undefined, width: offset, qty: offset + 1 });
        }
        const get = (key) => (c[key] !== undefined && parts[c[key]] !== undefined ? parts[c[key]] : "");
        const w = parseInt(get("width"), 10);
        const q = parseInt(get("qty"), 10);
        const l = parseInt(get("length"), 10);
        const oid = escapeAttr(get("orderId"));
        const od = toIsoDate(get("orderDate"));
        const dd = toIsoDate(get("deliveryDate"));
        const mat = escapeAttr(get("material"));
        const cust = escapeAttr(get("customer"));
        const itemNo = parseInt(get("item"), 10) > 0 ? parseInt(get("item"), 10) : "";
        if (!(w > 0 && q > 0)) return;

        if (currentMode === "1d") {
          createOrderRow(w, q, "", oid, od, dd);
          count++;
        } else if (l > 0) {
          createOrderRow(w, q, l, oid, od, dd, mat, cust, itemNo);
          count++;
        }
      });

      if (count === 0) {
        createOrderRow();
        const fmtHint = currentMode === "1d" ? "Order ID, Width, Quantity" : "Order ID, Width, Length, Quantity";
        showError(`No valid rows found in CSV. Expected columns: ${fmtHint} (header row optional).`);
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
    // orderIdMap: { "width": [{order_id, order_date, delivery_date, qty}] } for dispatch labelling
    orderIdMap = {};
    const orderMap = new Map();
    const rows = ordersTbody.querySelectorAll("tr");
    rows.forEach((r) => {
      const oid = r.querySelector(".order-id") ? r.querySelector(".order-id").value.trim() : "";
      const od  = r.querySelector(".order-date") ? r.querySelector(".order-date").value : "";
      const dd  = r.querySelector(".delivery-date") ? r.querySelector(".delivery-date").value : "";
      const w   = parseInt(r.querySelector(".order-width").value, 10);
      const q   = parseInt(r.querySelector(".order-qty").value, 10);
      if (w > 0 && q > 0) {
        orderMap.set(w, (orderMap.get(w) || 0) + q);
        const key = String(w);
        if (!orderIdMap[key]) orderIdMap[key] = [];
        orderIdMap[key].push({ order_id: oid || "—", order_date: od, delivery_date: dd, qty: q });
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

      // Stock (remnants included) is only deducted on "Mark as Cut", never at plan time, so a
      // cancelled or replaced plan leaves every stock roll in stock for the next plan.

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
          plan: combinedPlan,
          unfulfilled_orders: data.unfulfilled_orders || []
        };
      }

      masterRolls = masterRolls.filter((r) => {
        if (r.isRemnant && r.qty !== null && r.qty <= 0) {
          releaseRollIds("1d", [r]);  // a used-up physical remnant keeps its ID retired
          remnantRollSizes.delete(r.width);
          return false;
        }
        return true;
      });

      if (latestPlanData && latestPlanData.plan) {
        latestPlanData.plan.forEach((roll) => {
          if (roll.waste_mm === 0) {
            // Only the remnant promised by this same roll; leftovers already in stock stay
            masterRolls = masterRolls.filter((rem) => {
              if (rem.isRemnant && rem.sourceRollUid === roll.uid) {
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
      switchToPlanView();
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

  // KPI labels differ per mode (1D measures width in mm, 2D measures area in m²)
  function setKpiLabels(mode) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("kpi-yield-label", "Material Yield");
    set("kpi-rolls-label", mode === "2d" ? "Master Rolls Planned" : "Master Rolls Used");
    set("kpi-demand-label", mode === "2d" ? "Material Cut (Planned)" : "Width Demanded");
    set("kpi-waste-label", mode === "2d" ? "Scrap (not reusable)" : "Trim Scrap");
  }

  function renderPlanResults(data) {
    const { summary, plan } = data;

    // 1. Populate KPI Bar
    kpiSection.style.display = "grid";
    kpiYield.textContent = `${summary.efficiency_pct}%`;
    setKpiLabels("1d");
    { const kb = document.getElementById("kpi-balance"); if (kb) kb.style.display = "none"; }
    kpiYieldSub.textContent = "Pieces ÷ master width used";

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
    if (btnCancelPlan) btnCancelPlan.style.display = "inline-flex";
    planStatusNote.textContent = `${summary.rolls_used} master rolls planned (${cutCount} cut) • ${summary.efficiency_pct}% overall yield`;

    if (cutCount > 0 && btnReoptimize) {
      btnReoptimize.style.display = "inline-flex";
    }

    // 3. Order-ID allocation (cut rolls keep their frozen labels; see allocateOrderIds)
    allocateOrderIds(plan, "1d", completedRollIds);

    // 4. Render Each Roll Card
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

      // Group consumed assignments by order_id + width for manifest and drawer
      const manifestGrouped = {};
      (roll._consumedAssignments || []).forEach((a) => {
        const gKey = `${a.order_id}||${a.width}`;
        if (!manifestGrouped[gKey]) {
          manifestGrouped[gKey] = { ...a, qty: 0 };
        }
        manifestGrouped[gKey].qty += a.qty;
      });
      const groupedList = Object.values(manifestGrouped);

      const manifestItems = groupedList.map(a =>
        `<span class="manifest-item">
          <span class="manifest-order-tag">${a.order_id}</span>
          <strong>${a.width}mm</strong> &times; ${a.qty}
        </span>`
      ).join("");

      const consumedRowsHtml = groupedList.map(a =>
        `<tr>
          <td><span class="manifest-order-tag">${a.order_id}</span></td>
          <td><strong>${a.width}mm</strong> &times; ${a.qty}</td>
          <td>${a.order_date || "—"}</td>
          <td>${a.delivery_date || "—"}</td>
        </tr>`
      ).join("");

      const consumedDropdownHtml = `
        <div class="consumed-orders-drawer">
          <table class="consumed-orders-table">
            <thead>
              <tr><th>Order ID</th><th>Cut</th><th>Order Date</th><th>Delivery Date</th></tr>
            </thead>
            <tbody>${consumedRowsHtml}</tbody>
          </table>
        </div>
      `;

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
            <button type="button" class="btn-remnant-action" data-width="${roll.waste_mm}" data-roll-uid="${roll.uid}">
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
          <button type="button" class="btn-consumed-orders btn-action-inline">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span>Orders on Roll</span>
          </button>
          <button type="button" class="btn-view-trials btn-action-inline" title="View all combinations the model evaluated">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>Combinations (${trials.length})</span>
          </button>
        </div>
        ${remnantHtml}

        ${consumedDropdownHtml}

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
            ? `Hide Combinations`
            : `Combinations (${trials.length})`;
        });
      }

      // Event listener: Toggle consumed orders drawer
      const btnConsumed = card.querySelector(".btn-consumed-orders");
      const drawerConsumed = card.querySelector(".consumed-orders-drawer");
      if (btnConsumed && drawerConsumed) {
        btnConsumed.addEventListener("click", () => {
          drawerConsumed.classList.toggle("open");
          const open = drawerConsumed.classList.contains("open");
          btnConsumed.querySelector("span").textContent = open
            ? `Hide Orders`
            : `Orders on Roll`;
        });
      }

      // Event listener: Mark as Cut / Undo
      const btnCut = card.querySelector(".btn-mark-cut");
      btnCut.addEventListener("click", () => {
        const rollUid = roll.uid;
        // Find matching master roll in inventory
        let stockItem = null;
        if (completedRollIds.has(rollUid)) {
          stockItem = masterRolls.find((r) => r.consumed_orders && r.consumed_orders.some(c => c.roll_uid === rollUid || c.roll_num === roll.roll_num));
          if (!stockItem) stockItem = masterRolls.find((r) => r.width === roll.roll_width);
        } else {
          stockItem = masterRolls.find((r) => r.width === roll.roll_width && (r.qty === null || r.qty > 0));
          if (!stockItem) stockItem = masterRolls.find((r) => r.width === roll.roll_width);
        }

        const currentRollConsumed = (roll._consumedAssignments || []).map(c => ({ ...c, roll_uid: rollUid }));

        if (completedRollIds.has(rollUid)) {
          completedRollIds.delete(rollUid);
          if (stockItem && stockItem.qty !== null) {
            stockItem.qty += 1;
          }
          if (stockItem && stockItem.consumed_orders) {
            stockItem.consumed_orders = stockItem.consumed_orders.filter(c => c.roll_uid !== rollUid);
          }
          adjustOrderQty(roll._consumedAssignments || [], +1);  // same pieces back to the same orders
        } else {
          completedRollIds.add(rollUid);
          if (stockItem && stockItem.qty !== null) {
            stockItem.qty = Math.max(0, stockItem.qty - 1);
          }
          if (stockItem) {
            if (!stockItem.consumed_orders) stockItem.consumed_orders = [];
            stockItem.consumed_orders.push(...currentRollConsumed);
          }
          adjustOrderQty(roll._consumedAssignments || [], -1);  // deduct only this roll's orders
          if (roll.waste_mm >= 500) {
            const existingRemnant = masterRolls.find((r) => r.width === roll.waste_mm && r.isRemnant);
            if (existingRemnant) {
              existingRemnant.qty = (existingRemnant.qty !== null ? existingRemnant.qty : 0) + 1;
            } else {
              masterRolls.push({
                id: `mr_1d_rem_${Date.now()}`,
                roll_id: generateNextMasterRollId(),
                width: roll.waste_mm,
                qty: 1,
                isRemnant: true,
                consumed_orders: []
              });
            }
          }
        }

        renderRollChips();
        renderPlanResults(latestPlanData);
      });

      // Event listener: Report Defect
      const btnReject = card.querySelector(".btn-report-reject");
      btnReject.addEventListener("click", () => {
        // Pick the defective piece by order + width, so the re-cut is booked to the same order
        const pieces = roll._consumedAssignments || [];
        if (pieces.length === 0) return;
        let target = pieces[0];
        if (pieces.length > 1) {
          const opts = pieces.map((c, i) => `${i + 1}) ${c.order_id} — ${c.width}mm`).join("\n");
          const input = prompt(`Select defective piece to re-order on Roll #${roll.roll_num}:\n${opts}`, "1");
          if (input === null) return;
          const idx = parseInt(input, 10) - 1;
          if (!isNaN(idx) && pieces[idx]) target = pieces[idx];
        }
        adjustOrderQty([{ ...target, qty: 1 }], +1);
        if (btnReoptimize) btnReoptimize.style.display = "inline-flex";
        showError(`Added 1x ${target.width}mm for order ${target.order_id} back to demand. Click "↻ Re-Plan Remaining" to schedule it.`);
      });

      // Remnant button click
      if (roll.waste_mm > 0) {
        const btnRemnant = card.querySelector(".btn-remnant-action");
        if (btnRemnant) {
          btnRemnant.addEventListener("click", () => {
            const w = roll.waste_mm;
            const existing = masterRolls.find((r) => r.isRemnant && r.sourceRollUid === roll.uid);
            if (existing) {
              masterRolls = masterRolls.filter((val) => val !== existing);
              if (!masterRolls.some((r) => r.isRemnant && r.width === w)) remnantRollSizes.delete(w);
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

    // Render "To Be Produced" panel for unfulfilled orders
    const unfulfilled1D = data.unfulfilled_orders || [];
    renderUnfulfilledPanel(unfulfilled1D, "1d");
  }

  // ===================================================================
  // 2D Optimization & Rendering
  // ===================================================================
  async function runOptimization2D(isReplan = false) {
    // SAP rule: one Order ID belongs to one customer; item numbers are unique per order
    assignItemNumbers();
    const orderProblems = checkOrderIds();
    if (orderProblems.length) {
      showError(`Please fix the order list before planning:\n• ${orderProblems.join("\n• ")}`);
      return;
    }
    cleanupUncutRemnants2D();
    renderRollChips();

    if (masterRolls2D.length === 0) {
      showError("Please specify at least one 2D master roll (width and length) in the inventory.");
      return;
    }

    // Rolls with stock left. If none, the orders go straight to the manufacture panel.
    const availableRolls = masterRolls2D.filter((r) => r.qty === null || r.qty > 0);

    // Collect 2D orders from table
    // orderIdMap: { "width_length": [{order_id, order_date, delivery_date, qty}] } for dispatch labelling
    orderIdMap = {};
    const orderList = [];
    const rows = ordersTbody.querySelectorAll("tr");
    rows.forEach((r) => {
      const oidInput = r.querySelector(".order-id");
      const wInput   = r.querySelector(".order-width");
      const lInput   = r.querySelector(".order-length");
      const qInput   = r.querySelector(".order-qty");
      const odInput  = r.querySelector(".order-date");
      const ddInput  = r.querySelector(".delivery-date");
      const matInput = r.querySelector(".order-material");
      const oid = oidInput ? oidInput.value.trim() : "";
      const od  = odInput  ? odInput.value  : "";
      const dd  = ddInput  ? ddInput.value  : "";
      const mat = normMat(matInput ? matInput.value : "");
      const w = wInput ? parseInt(wInput.value, 10) : 0;
      const l = lInput ? parseInt(lInput.value, 10) : 0;
      const q = qInput ? parseInt(qInput.value, 10) : 0;
      if (w > 0 && l > 0 && q > 0) {
        orderList.push({ width: w, length: l, quantity: q, material: mat, delivery_date: dd });
        const key = `${w}_${l}`;
        if (!orderIdMap[key]) orderIdMap[key] = [];
        orderIdMap[key].push({ order_id: oid || "—", order_date: od, delivery_date: dd, qty: q });
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

    // Orders that no in-stock roll can hold are not sent to the solver;
    // they are reported as unfulfilled so the manufacture panel can cover them.
    // An order can only be cut from a master roll of the same material
    const fitsStock = (o) => availableRolls.some((r) => normMat(r.material) === o.material && r.width >= o.width && r.length >= o.length);
    const placeableOrders = orderList.filter(fitsStock);
    const unplaceableOrders = orderList.filter((o) => !fitsStock(o));

    const completedRollsSoFar = (latestPlanData2D && latestPlanData2D.plan)
      ? latestPlanData2D.plan.filter((r) => completedRollIds2D.has(r.uid))
      : [];

    if (placeableOrders.length === 0) {
      // No stock can cut any remaining order — keep completed rolls, show manufacture panel
      completedRollsSoFar.forEach((r, idx) => { r.roll_num = idx + 1; });
      latestPlanData2D = {
        summary: computePlanSummary2D(completedRollsSoFar),
        plan: completedRollsSoFar,
        unfulfilled_orders: orderList
      };
      renderRollChips();
      renderPlanResults2D(latestPlanData2D);
      // Nothing could be planned — stay on the inputs page where the manufacture panel is
      switchToInputsView();
      const mfgPanel = document.querySelector(".input-panel .unfulfilled-panel");
      if (mfgPanel) mfgPanel.scrollIntoView({ behavior: "smooth", block: "start" });
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
      // Each material is planned separately on its own master rolls, then merged
      const materials = [...new Set(placeableOrders.map((o) => o.material))];
      const data = { plan: [], unfulfilled_orders: [] };
      for (const mat of materials) {
        const matOrders = placeableOrders.filter((o) => o.material === mat);
        const matRolls = availableRolls.filter((r) => normMat(r.material) === mat);
        const solveMat = async (priority) => {
          const response = await fetch("/api/optimize-2d", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              master_rolls: matRolls.map((r) => ({ width: r.width, length: r.length, qty: r.qty, isRemnant: !!r.isRemnant })),
              orders: matOrders.map((o) => ({ width: o.width, length: o.length, quantity: o.quantity })),
              priority
            })
          });
          const res = await response.json();
          if (!response.ok) throw new Error(res.error || "Failed to calculate 2D cutting plan.");
          return res;
        };
        let part = await solveMat([]);
        // Not enough master rolls for everything → re-plan so urgent orders are cut first
        const priority = deliveryPriority(matOrders);
        if ((part.unfulfilled_orders || []).length > 0 && priority.length > 0) {
          part = await solveMat(priority);
          part.prioritized = true;
        }
        if (part.prioritized) data.prioritized = true;
        (part.plan || []).forEach((r) => { r.material = mat; data.plan.push(r); });
        (part.unfulfilled_orders || []).forEach((o) => data.unfulfilled_orders.push({ ...o, material: mat }));
      }
      const unfulfilledAll = [...data.unfulfilled_orders, ...unplaceableOrders];

      // Remnant rolls are treated like normal stock: their qty drops only when the roll
      // using them is marked as cut (by its master_roll_id). Planning alone no longer
      // removes them, so each remnant keeps its ID and its cut/order history.

      // Check if any rolls are marked as cut (final)
      const completedRolls = (latestPlanData2D && latestPlanData2D.plan)
        ? latestPlanData2D.plan.filter((r) => completedRollIds2D.has(r.uid))
        : [];

      if (completedRolls.length > 0 || isReplan) {
        assignRollUids(data.plan);
        const combinedPlan = [...completedRolls, ...data.plan];
        combinedPlan.forEach((r, idx) => { r.roll_num = idx + 1; });

        latestPlanData2D = {
          summary: computePlanSummary2D(combinedPlan),
          plan: combinedPlan,
          unfulfilled_orders: unfulfilledAll
        };
      } else {
        completedRollIds2D.clear();
        assignRollUids(data.plan);
        data.plan.forEach((r, idx) => { r.roll_num = idx + 1; });
        latestPlanData2D = {
          summary: computePlanSummary2D(data.plan),
          plan: data.plan,
          unfulfilled_orders: unfulfilledAll
        };
      }

      latestPlanData2D.prioritized = !!data.prioritized;

      // Assign master_roll_id from inventory to each plan roll (FIFO by width×length)
      {
        // IDs already held by completed rolls must not be handed out again
        const usedInventoryIds = new Set(
          latestPlanData2D.plan.filter((r) => r.master_roll_id).map((r) => r.master_roll_id)
        );
        latestPlanData2D.plan.forEach((planRoll) => {
          if (planRoll.master_roll_id) return; // already assigned (completed roll)
          const fits = (inv) =>
            normMat(inv.material) === normMat(planRoll.material) &&
            inv.width === planRoll.master_width &&
            inv.length === planRoll.master_length &&
            inv.roll_id &&
            (inv.qty === null || inv.qty > 0) &&   // skip rolls already cut (0 in stock)
            !usedInventoryIds.has(inv.roll_id);
          // Real stock first, then rolls still to be manufactured
          const match = masterRolls2D.find((inv) => fits(inv) && !inv.isToProduce)
            || masterRolls2D.find((inv) => fits(inv) && inv.isToProduce);
          if (match) {
            planRoll.master_roll_id = match.roll_id;
            usedInventoryIds.add(match.roll_id);
          }
        });

        // Uncut "To Manufacture" rolls the new plan doesn't use are dropped,
        // freeing their IDs for reuse. Produced (cut) rolls are kept.
        masterRolls2D = masterRolls2D.filter((inv) =>
          !(inv.isToProduce && inv.qty !== null && inv.qty > 0 && !usedInventoryIds.has(inv.roll_id))
        );
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
      switchToPlanView();
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

  function computePlanSummary2D(combinedPlan) {
    let totalCutArea = 0;
    let totalRawAllocArea = 0;
    let rawMasterRollsCount = 0;

    const remnantsProduced = [];

    combinedPlan.forEach((r) => {
      totalCutArea += (r.total_used_area || 0);

      // Check if this roll was cut from a remnant produced by an earlier roll
      const consumedIdx = remnantsProduced.findIndex(rem =>
        !rem.consumed && rem.width === r.master_width && rem.length === r.master_length
      );

      if (consumedIdx !== -1) {
        remnantsProduced[consumedIdx].consumed = true;
      } else {
        totalRawAllocArea += (r.roll_area || (r.master_width * r.master_length));
        rawMasterRollsCount += 1;
      }

      if (r.remnant_length >= 10 && r.remnant_area > 0) {
        remnantsProduced.push({
          width: r.master_width,
          length: r.remnant_length,
          area: r.remnant_area,
          consumed: false
        });
      }

      if (r.sections) {
        r.sections.forEach((sec) => {
          if (sec.width_waste_mm >= 150 && sec.section_length >= 10) {
            remnantsProduced.push({
              width: sec.width_waste_mm,
              length: sec.section_length,
              area: sec.width_waste_mm * sec.section_length,
              consumed: false
            });
          }
        });
      }
    });

    if (totalRawAllocArea === 0 && combinedPlan.length > 0) {
      totalRawAllocArea = combinedPlan.reduce((acc, r) => acc + (r.roll_area || 0), 0);
    }

    const activeRemnants = remnantsProduced.filter(rem => !rem.consumed);
    const totalActiveRemArea = activeRemnants.reduce((acc, rem) => acc + rem.area, 0);

    const netScrap = Math.max(0, totalRawAllocArea - totalCutArea - totalActiveRemArea);
    const netScrapPct = roundToTwo((netScrap / (totalRawAllocArea || 1)) * 100);
    const materialYieldPct = roundToTwo((totalCutArea / (totalRawAllocArea || 1)) * 100);
    const overallUtilPct = roundToTwo(((totalCutArea + totalActiveRemArea) / (totalRawAllocArea || 1)) * 100);

    return {
      rolls_used: combinedPlan.length,
      raw_master_rolls_count: rawMasterRollsCount || combinedPlan.length,
      total_product_cut_area: totalCutArea,
      total_roll_area_allocated: totalRawAllocArea,
      total_reusable_remnant: totalActiveRemArea,
      net_scrap_area: netScrap,
      net_scrap_pct: netScrapPct,
      slitting_efficiency_pct: materialYieldPct,
      overall_roll_utilization_pct: overallUtilPct
    };
  }

  function renderPlanResults2D(data) {
    const { summary, plan } = data;

    // 1. Populate KPI Bar
    kpiSection.style.display = "grid";
    setKpiLabels("2d");
    kpiYield.textContent = `${summary.slitting_efficiency_pct}%`;
    kpiYieldSub.textContent = "Order pieces ÷ master roll area";

    const reCuts = (summary.raw_master_rolls_count && summary.raw_master_rolls_count !== summary.rolls_used)
      ? summary.rolls_used - summary.raw_master_rolls_count : 0;
    const rollsLabel = reCuts > 0
      ? `${summary.raw_master_rolls_count} Master Rolls + ${reCuts} remnant re-cut${reCuts > 1 ? "s" : ""}`
      : `${summary.rolls_used} Rolls`;
    kpiRolls.textContent = rollsLabel;
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
    kpiCutsCount.textContent = `${totalPieces} pieces in plan`;

    const netScrapM2 = ((summary.net_scrap_area !== undefined ? summary.net_scrap_area : 0) / 1000).toFixed(2);
    const totalRemM2 = ((summary.total_reusable_remnant || 0) / 1000).toFixed(2);
    const widthRemM2 = ((summary.total_width_remnant || 0) / 1000).toFixed(2);
    const lengthRemM2 = ((summary.total_length_remnant || 0) / 1000).toFixed(2);
    const scrapPct = summary.net_scrap_pct !== undefined
      ? summary.net_scrap_pct
      : ((summary.net_scrap_area / (summary.total_roll_area_allocated || 1)) * 100).toFixed(2);

    // Material balance of the master roll area: pieces + reusable leftover + scrap = 100%
    const alloc = summary.total_roll_area_allocated || 0;
    const pPieces = alloc ? (summary.total_product_cut_area / alloc) * 100 : 0;
    const pScrap = alloc ? ((summary.net_scrap_area || 0) / alloc) * 100 : 0;
    const pLeft = Math.max(0, 100 - pPieces - pScrap);   // remainder, so the three add up to 100
    kpiWaste.textContent = `${pScrap.toFixed(2)}%`;
    kpiWastePct.textContent = `${netScrapM2} m² — side trim & tails that cannot be reused`;
    const kb = document.getElementById("kpi-balance");
    if (kb) {
      kb.style.display = "block";
      kb.innerHTML = `
        <div class="kpi-balance-title">Where the master roll area goes <span>(${(alloc / 1000).toFixed(2)} m² = 100%)</span></div>
        <div class="kpi-balance-bar">
          <span class="kb-pieces" style="width:${pPieces}%"></span><span class="kb-left" style="width:${pLeft}%"></span><span class="kb-scrap" style="width:${pScrap}%"></span>
        </div>
        <div class="kpi-balance-legend">
          <span><i class="kb-pieces"></i>Order pieces <strong>${pPieces.toFixed(2)}%</strong> (${cutAreaM2} m²)</span>
          <span><i class="kb-left"></i>Reusable leftover <strong>${pLeft.toFixed(2)}%</strong> (${totalRemM2} m²) — uncut length & side offcuts ≥ 150 mm</span>
          <span><i class="kb-scrap"></i>Scrap <strong>${pScrap.toFixed(2)}%</strong> (${netScrapM2} m²)</span>
          <span class="kb-total">= 100%</span>
        </div>`;
    }

    // 2. Hide Empty State, Show Plan Cards
    emptyState.style.display = "none";
    planContainer.style.display = "flex";
    planContainer.innerHTML = "";

    const cutCount = plan.filter((r) => completedRollIds2D.has(r.uid)).length;
    if (btnCancelPlan) btnCancelPlan.style.display = "inline-flex";
    planStatusNote.textContent = `${summary.rolls_used} 2D master rolls planned (${cutCount} cut) • ${summary.slitting_efficiency_pct}% material yield`
      + (data.prioritized ? " • Not enough master rolls — orders with the earliest delivery dates were planned first" : "");

    if (btnReoptimize) {
      btnReoptimize.style.display = (completedRollIds2D.size > 0) ? "inline-flex" : "none";
    }

    // 3. Order-ID allocation per run (cut rolls keep their frozen labels; see allocateOrderIds)
    allocateOrderIds(plan, "2d", completedRollIds2D);

    // 4. Render Each 2D Roll Card
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

      // Build grouped consumed rows from pre-computed FIFO assignments
      const rollGrouped = {};
      (roll._consumedAssignments || []).forEach((a) => {
        const gKey = `${a.order_id}||${a.item || ""}||${a.width}||${a.length}`;
        if (!rollGrouped[gKey]) rollGrouped[gKey] = { ...a, qty: 0 };
        rollGrouped[gKey].qty += a.qty;
      });
      const allConsumedRows = Object.values(rollGrouped).map((a) => ({
        _html: `<tr>
          <td><strong>${orderRef(a)}</strong></td>
          <td>${a.customer || "—"}</td>
          <td>${a.material || normMat(roll.material) || "—"}</td>
          <td>${a.width}mm × ${a.length}m</td>
          <td>${a.order_date || "—"}</td>
          <td>${a.delivery_date || "—"}</td>
          <td style="text-align:right;"><strong>${a.qty}</strong></td>
        </tr>`
      }));
      // Render Sections (Slitting Runs)
      let sectionsHtml = "";
      roll.sections.forEach((sec, sIdx) => {
        let lanesHtml = "";
        sec.cuts.forEach((cut) => {
          const color = getColorForWidth(cut.width);
          // A stacked lane holds `stack` pieces wound end-to-end (separated at rewinding)
          const stack = cut.stack || 1;
          const lanes = Math.ceil(cut.quantity / stack);
          for (let p = 0; p < lanes; p++) {
            const wPct = ((cut.width / roll.master_width) * 100).toFixed(2);
            const title = stack > 1
              ? `Lane ${cut.width}mm: ${stack} pieces of ${cut.width}mm × ${cut.length}m end-to-end (${stack * cut.length}m of the ${sec.section_length}m run)`
              : `Cut: ${cut.width}mm x ${cut.length}m (${wPct}% of width)`;
            lanesHtml += `
              <div class="slitting-lane ${stack > 1 ? "is-stacked" : ""}" style="width: ${wPct}%; background-color: ${color};" title="${title}">
                ${cut.width}${stack > 1 ? `<span class="lane-stack-tag">${stack}×${cut.length}m</span>` : ""}
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
        const secGrouped = {};
        (sec._consumedAssignments || []).forEach((a) => {
          const gKey = `${a.order_id}||${a.item || ""}||${a.width}||${a.length}`;
          if (!secGrouped[gKey]) secGrouped[gKey] = { ...a, qty: 0 };
          secGrouped[gKey].qty += a.qty;
        });
        const cutsSummaryList = Object.values(secGrouped).map((a) => `
          <span class="section-manifest-item" title="Order ${orderRef(a)}${a.customer ? ` · ${a.customer}` : ""}${a.material ? ` · ${a.material}` : ""}">
            <span class="manifest-order-tag">${orderRef(a)}</span>
            ${a.customer ? `<span class="manifest-customer">${a.customer}</span>` : ""}
            <strong>${a.width}mm × ${a.length}m</strong> × ${a.qty} pcs
          </span>
        `).join("");

        const wb = runWasteBreakdown(sec, roll.master_width);
        sectionsHtml += `
          <div class="section-card-2d">
            <div class="section-header-2d">
              <div class="section-title">
                <span class="section-badge">Run #${sIdx + 1}</span>
                <span>Length: <strong>${sec.section_length.toLocaleString()} m</strong></span>
              </div>
              <div class="section-stats-inline">
                Width: ${sec.used_width_mm.toLocaleString()} / ${roll.master_width.toLocaleString()} mm
                &bull; ${isWidthRem ? "Side Offcut" : "Side Trim"}: <span style="color: ${isWidthRem ? 'var(--accent-remnant)' : 'var(--accent-danger)'}; font-weight: 600;" title="Unused width across the full run length">${sec.width_waste_mm} mm (${wb.trimPct}%)</span>
                ${wb.hasTail ? `&bull; Length Tail: <span style="color: var(--accent-danger); font-weight: 600;" title="Pieces shorter than the run length leave an unused tail on their lanes">${wb.tailPct}%</span>` : ""}
                &bull; Run Waste: <strong title="Side trim + length tail, as % of this run's area">${wb.totalPct}%</strong>
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

        // Check if length remnant was consumed by a subsequent roll in the plan
        const consumingLengthRoll = hasLengthRem
          ? plan.find((r) => r.roll_num > roll.roll_num && r.master_width === roll.master_width && r.master_length === roll.remnant_length)
          : null;

        // Check if width offcut was consumed by a subsequent roll in the plan
        const consumingWidthRoll = majorWidthRem
          ? plan.find((r) => r.roll_num > roll.roll_num && r.master_width === majorWidthRem.width && r.master_length === majorWidthRem.length)
          : null;

        const inStockL = masterRolls2D.some((r) => r.sourceRollUid === roll.uid && r.width === roll.master_width && r.length === roll.remnant_length);
        const inStockW = majorWidthRem && masterRolls2D.some((r) => r.sourceRollUid === roll.uid && r.width === majorWidthRem.width && r.length === majorWidthRem.length);

        if (hasLengthRem && majorWidthRem) {
          const lRemArea = ((roll.master_width * roll.remnant_length) / 1000).toFixed(2);
          descText = `Reusable Remnants: Length (${roll.master_width.toLocaleString()} mm &times; ${roll.remnant_length.toLocaleString()} m) and Side Offcut (${majorWidthRem.width.toLocaleString()} mm &times; ${majorWidthRem.length.toLocaleString()} m)`;

          let btnL = "";
          if (consumingLengthRoll) {
            btnL = `<button type="button" class="btn-remnant-2d btn-remnant-consumed" disabled title="Utilized to cut Roll #${consumingLengthRoll.roll_num}">✓ Consumed in Roll #${consumingLengthRoll.roll_num}</button>`;
          } else {
            btnL = `<button type="button" class="btn-remnant-2d ${inStockL ? 'btn-remnant-added' : ''}" data-w="${roll.master_width}" data-l="${roll.remnant_length}" data-source-uid="${roll.uid}">
              ${inStockL ? '✓ Length in Stock' : `+ Add Length (${roll.master_width}mm × ${roll.remnant_length}m)`}
            </button>`;
          }

          let btnW = "";
          if (consumingWidthRoll) {
            btnW = `<button type="button" class="btn-remnant-2d btn-width-remnant btn-remnant-consumed" disabled title="Utilized to cut Roll #${consumingWidthRoll.roll_num}">✓ Consumed in Roll #${consumingWidthRoll.roll_num}</button>`;
          } else {
            btnW = `<button type="button" class="btn-remnant-2d btn-width-remnant ${inStockW ? 'btn-remnant-added' : ''}" data-w="${majorWidthRem.width}" data-l="${majorWidthRem.length}" data-source-uid="${roll.uid}">
              ${inStockW ? '✓ Offcut in Stock' : `+ Add Offcut (${majorWidthRem.width}mm × ${majorWidthRem.length}m)`}
            </button>`;
          }
          buttonsHtml = btnL + btnW;
        } else if (hasLengthRem) {
          const lRemArea = ((roll.master_width * roll.remnant_length) / 1000).toFixed(2);
          descText = `Uncut Roll Remnant: <strong>${roll.master_width.toLocaleString()} mm &times; ${roll.remnant_length.toLocaleString()} m</strong> (${lRemArea} m²)`;
          if (consumingLengthRoll) {
            buttonsHtml = `<button type="button" class="btn-remnant-2d btn-remnant-consumed" disabled title="Utilized to cut Roll #${consumingLengthRoll.roll_num}">✓ Consumed in Roll #${consumingLengthRoll.roll_num} (${roll.master_width}mm × ${roll.remnant_length}m)</button>`;
          } else {
            buttonsHtml = `
              <button type="button" class="btn-remnant-2d ${inStockL ? 'btn-remnant-added' : ''}" data-w="${roll.master_width}" data-l="${roll.remnant_length}" data-source-uid="${roll.uid}">
                ${inStockL ? '✓ Queued in Stock' : `+ Add Remnant to Stock (${roll.master_width}mm × ${roll.remnant_length}m)`}
              </button>
            `;
          }
        } else if (majorWidthRem) {
          descText = `Reusable Side Offcut: <strong>${majorWidthRem.width.toLocaleString()} mm &times; ${majorWidthRem.length.toLocaleString()} m</strong> (${majorWidthRem.area} m²)`;
          if (consumingWidthRoll) {
            buttonsHtml = `<button type="button" class="btn-remnant-2d btn-width-remnant btn-remnant-consumed" disabled title="Utilized to cut Roll #${consumingWidthRoll.roll_num}">✓ Consumed in Roll #${consumingWidthRoll.roll_num} (${majorWidthRem.width}mm × ${majorWidthRem.length}m)</button>`;
          } else {
            buttonsHtml = `
              <button type="button" class="btn-remnant-2d btn-width-remnant ${inStockW ? 'btn-remnant-added' : ''}" data-w="${majorWidthRem.width}" data-l="${majorWidthRem.length}" data-source-uid="${roll.uid}">
                ${inStockW ? '✓ Queued in Stock' : `+ Add Remnant to Stock (${majorWidthRem.width}mm × ${majorWidthRem.length}m)`}
              </button>
            `;
          }
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
            ${roll.master_roll_id ? `<span class="chip-roll-id" style="font-size:11px;">${roll.master_roll_id}</span>` : ""}
            <span class="roll-capacity-badge">${roll.master_width.toLocaleString()} mm &times; ${roll.master_length.toLocaleString()} m Master</span>
            ${(() => {
              const inv = masterRolls2D.find((x) => x.roll_id && x.roll_id === roll.master_roll_id) || {};
              const mat = normMat(roll.material || inv.material);
              return mat || inv.gsm ? `<span class="chip-material" title="Material code · grammage">${mat || "—"}${inv.gsm ? ` · ${inv.gsm} gsm` : ""}</span>` : "";
            })()}
            ${statusTagHtml}
          </div>
          <span class="yield-pill ${pillClass}" title="Run yield = area of customer pieces ÷ master roll area actually slit (uncut remnant excluded). Scrap = side trim < 150 mm + length tails. Reusable offcut = side strips ≥ 150 mm offered back to stock.">
            ${rollYieldText(roll, " &middot; ")}
          </span>
        </div>

        <div class="length-bar-container">
          <div class="length-bar-label">
            <span title="How much of the master roll length was run through the slitter (not a yield figure)">Master Length Used: <strong>${roll.length_used.toLocaleString()} m</strong> (${pctUsed}%)</span>
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
            Defect (+1)
          </button>
          <button type="button" class="btn-consumed-orders btn-action-inline">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span>Orders on Roll</span>
          </button>
          ${(() => {
            const trials = roll.candidates_explored && roll.candidates_explored.length > 0 ? roll.candidates_explored : [];
            if (trials.length === 0) return "";
            return `<button type="button" class="btn-view-trials btn-action-inline" title="View all slitting combinations the ML model evaluated">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span>Combos (${trials.length})</span>
            </button>`;
          })()}
        </div>

        ${remnantBannerHtml}

        <div class="consumed-orders-drawer">
          <table class="consumed-orders-table">
            <thead>
              <tr><th>Order ID</th><th>Customer</th><th>Material</th><th>Cut Size</th><th>Order Date</th><th>Delivery Date</th><th style="text-align:right;">Qty</th></tr>
            </thead>
            <tbody>${allConsumedRows.length > 0 ? allConsumedRows.map(r => r._html).join("") : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted,#888);">No order data</td></tr>'}</tbody>
          </table>
        </div>

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
              <td>Side trim ${t.width_waste_mm !== undefined ? t.width_waste_mm.toLocaleString() : ""} mm · run waste ${t.waste_area_pct}%</td>
              <td><strong>${t.yield_pct}%</strong></td>
            </tr>
          `).join("");

          return `
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

      // Event listener: Toggle consumed orders drawer for 2D
      const btnConsumed = card.querySelector(".btn-consumed-orders");
      const drawerConsumed = card.querySelector(".consumed-orders-drawer");
      if (btnConsumed && drawerConsumed) {
        btnConsumed.addEventListener("click", () => {
          drawerConsumed.classList.toggle("open");
          const open = drawerConsumed.classList.contains("open");
          btnConsumed.querySelector("span").textContent = open
            ? `Hide Orders`
            : `Orders on Roll`;
        });
      }

      // Event listener: Toggle trials drawer for 2D
      const btnToggleTrials = card.querySelector(".btn-view-trials");
      const drawerTrials = card.querySelector(".trials-drawer");
      if (btnToggleTrials && drawerTrials) {
        const trialsCount = roll.candidates_explored ? roll.candidates_explored.length : 0;
        btnToggleTrials.addEventListener("click", () => {
          drawerTrials.classList.toggle("open");
          const open = drawerTrials.classList.contains("open");
          btnToggleTrials.querySelector("span").textContent = open
            ? `Hide Combos`
            : `Combos (${trialsCount})`;
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
            const parentInv = masterRolls2D.find((x) => x.roll_id === roll.master_roll_id) || {};
            masterRolls2D.push({ width: w, length: l, qty: 1, isRemnant: true, sourceRollUid: sourceUid, parentRollId: roll.master_roll_id || "", roll_id: generateRemnantRollId2D(roll.master_roll_id), material: roll.material || parentInv.material || "", gsm: parentInv.gsm || null });
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

          // The physical master roll is the one whose ID is on this card.
          // Only rolls without an ID fall back to matching by size.
          let stockItem = null;
          if (roll.master_roll_id) {
            stockItem = masterRolls2D.find((r) => r.roll_id === roll.master_roll_id) || null;
          } else if (completedRollIds2D.has(uid)) {
            stockItem = masterRolls2D.find((r) => r.consumed_orders && r.consumed_orders.some(c => c.roll_uid === uid));
          } else {
            stockItem = masterRolls2D.find((r) => r.width === roll.master_width && r.length === roll.master_length && (r.qty === null || r.qty > 0));
          }

          // Per-order pieces on this roll (frozen once cut, used again on undo)
          const assignments = roll._consumedAssignments || [];
          const currentRollConsumed = assignments.map(c => ({ ...c, roll_uid: uid, master_roll_id: roll.master_roll_id || "" }));

          if (completedRollIds2D.has(uid)) {
            // Undo: same pieces go back to the same order rows
            completedRollIds2D.delete(uid);
            if (stockItem && stockItem.qty !== null) {
              stockItem.qty += 1;
            }
            if (stockItem && stockItem.consumed_orders) {
              stockItem.consumed_orders = stockItem.consumed_orders.filter(c => c.roll_uid !== uid);
            }
            adjustOrderQty(assignments, +1);
          } else {
            completedRollIds2D.add(uid);
            if (stockItem && stockItem.qty !== null) {
              stockItem.qty = Math.max(0, stockItem.qty - 1);
            }
            if (stockItem) {
              if (!stockItem.consumed_orders) stockItem.consumed_orders = [];
              stockItem.consumed_orders.push(...currentRollConsumed);
            }
            adjustOrderQty(assignments, -1);
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
          // Pick the defective piece by order + size, so the re-cut is booked to the same order
          const pieces = roll._consumedAssignments || [];
          if (pieces.length === 0) return;
          let target = pieces[0];
          if (pieces.length > 1) {
            const opts = pieces.map((c, i) => `${i + 1}) ${orderRef(c)}${c.customer ? ` (${c.customer})` : ""} — ${c.width}mm x ${c.length}m`).join("\n");
            const input = prompt(`Select defective piece to re-order on Roll #${roll.roll_num}${roll.master_roll_id ? ` (${roll.master_roll_id})` : ""}:\n${opts}`, "1");
            if (input === null) return;
            const idx = parseInt(input, 10) - 1;
            if (!isNaN(idx) && pieces[idx]) target = pieces[idx];
          }
          adjustOrderQty([{ ...target, qty: 1 }], +1);
          (roll._defects = roll._defects || []).push({ ...target, qty: 1 });
          if (btnReoptimize) btnReoptimize.style.display = "inline-flex";
          showError(`Added 1x ${target.width}mm x ${target.length}m for order ${orderRef(target)}${target.customer ? ` (${target.customer})` : ""} back to demand. Click "↻ Re-Plan Remaining" to schedule it.`);
        });
      }

      planContainer.appendChild(card);
    });

    syncRemnantButtons2D();
    btnExportImg.style.display = "inline-flex";
    btnPrint.style.display = "inline-flex";
    if (btnExportTrials) btnExportTrials.style.display = "inline-flex";
    if (exportOptionsBar) exportOptionsBar.style.display = "flex";

    // Render "To Be Produced" panel for unfulfilled 2D orders
    const unfulfilled2D = data.unfulfilled_orders || [];
    renderUnfulfilledPanel(unfulfilled2D, "2d");
  }

  // ===================================================================
  // Export Handlers (1D & 2D)
  // ===================================================================

  // ===================================================================
  // Unfulfilled Orders Panel
  // ===================================================================
  function renderUnfulfilledPanel(unfulfilledOrders, mode) {
    // Remove any existing panel / plan-page notice (2D panel lives on the inputs page)
    document.querySelectorAll(".unfulfilled-panel, .unfulfilled-plan-notice").forEach((el) => el.remove());

    if (!unfulfilledOrders || unfulfilledOrders.length === 0) return;
    if (mode !== "2d") { renderUnfulfilledPanelFor(unfulfilledOrders, mode, ""); return; }
    // 2D: one panel per material — master rolls are suggested only from that material
    const mats = [...new Set(unfulfilledOrders.map((o) => normMat(o.material)))];
    mats.forEach((m) => renderUnfulfilledPanelFor(unfulfilledOrders.filter((o) => normMat(o.material) === m), mode, m));
  }

  function renderUnfulfilledPanelFor(unfulfilledOrders, mode, material) {
    const is2D = (mode === "2d");
    const matLabel = material ? ` — Material ${material}` : "";

    // For 1D: simple read-only table (unchanged)
    if (!is2D) {
      const inventory = masterRolls;
      const rowsHtml = unfulfilledOrders.map((o) => {
        const w = o.width, q = o.quantity;
        const wideEnough = inventory.filter((r) => r.width >= w);
        const fit = wideEnough.find((r) => r.qty === null || r.qty > 0);
        const suggestion = fit
          ? `${fit.width}mm master roll in stock \u2014 re-plan to allocate`
          : wideEnough.length
            ? `${wideEnough[0].width}mm master roll size exists but none left in stock \u2014 add more master rolls`
            : `No master roll wide enough \u2014 add a master roll \u2265 ${w} mm`;
        return `<tr>
          <td>${w}mm</td>
          <td><strong>${q}</strong></td>
          <td><span class="produce-suggestion">${suggestion}</span></td>
        </tr>`;
      }).join("");

      const panel = document.createElement("div");
      panel.className = "unfulfilled-panel";
      panel.innerHTML = `
        <div class="unfulfilled-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <span>Orders Not Covered \u2014 More Master Rolls Needed</span>
        </div>
        <table class="unfulfilled-table">
          <thead><tr><th>Order Size</th><th>Qty Remaining</th><th>Suggested Roll</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
      if (planContainer.parentElement) planContainer.after(panel);
      return;
    }

    // ── 2D: Manufacture panel — suggest full master rolls based on stock sizes ──
    // Merge duplicate unfulfilled sizes (same width × length → sum qty)
    const mergedMap = {};
    unfulfilledOrders.forEach((o) => {
      const key = `${o.width}_${o.length}`;
      if (!mergedMap[key]) mergedMap[key] = { width: o.width, length: o.length, quantity: 0 };
      mergedMap[key].quantity += o.quantity;
    });
    const pending = Object.values(mergedMap);
    const totalPieces = pending.reduce((sum, p) => sum + p.quantity, 0);

    // Candidate master roll sizes = distinct non-remnant sizes in 2D stock
    const stockSizes = [];
    masterRolls2D.forEach((r) => {
      if (r.isRemnant || normMat(r.material) !== material) return;
      if (!stockSizes.some((s) => s.width === r.width && s.length === r.length)) {
        stockSizes.push({ width: r.width, length: r.length });
      }
    });

    const matGsm = (masterRolls2D.find((r) => normMat(r.material) === material && r.gsm) || {}).gsm || null;
    const pendingRowsHtml = pending.map((p) => `
      <tr>
        <td><strong>${p.width.toLocaleString()} mm × ${p.length.toLocaleString()} m</strong></td>
        <td style="text-align:center;"><strong>${p.quantity}</strong> pieces</td>
        <td><span class="produce-suggestion">⚠ Not covered — needs more master rolls</span></td>
      </tr>
    `).join("");

    const panel = document.createElement("div");
    panel.className = "unfulfilled-panel";
    panel.innerHTML = `
      <div class="unfulfilled-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>${totalPieces} Piece${totalPieces > 1 ? "s" : ""} Could Not Be Covered${matLabel} — Not Enough Master Rolls in Stock</span>
      </div>
      <table class="unfulfilled-table">
        <thead>
          <tr>
            <th>Required Cut Size</th>
            <th style="text-align:center;">Unfulfilled Qty</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${pendingRowsHtml}</tbody>
      </table>

      <p class="unfulfilled-desc" style="margin-top:14px;">
        Master rolls to manufacture for these pieces. Tick one size, or tick several to mix sizes — smaller or shorter rolls take the pieces that would leave a big roll half empty. Roll counts can be edited, and you can add a custom width × length.
      </p>
      <table class="unfulfilled-table mfg-options-table">
        <thead>
          <tr>
            <th style="width:30px;"></th>
            <th>Master Roll Size</th>
            <th style="text-align:center;">Rolls Needed</th>
            <th style="text-align:center;" title="Area of order pieces ÷ area of the master rolls made">Yield</th>
            <th>Covers</th>
          </tr>
        </thead>
        <tbody class="mfg-options-body">
          <tr><td colspan="5" class="mfg-loading">Calculating master rolls needed…</td></tr>
        </tbody>
      </table>
      <div class="mfg-mix-box" style="display:none;"></div>
      <div class="mfg-waste-hint" style="display:none;"></div>

      <div class="mfg-custom-row">
        <span class="mfg-custom-label">Custom size:</span>
        <input type="number" class="mfg-custom-width" placeholder="Width (mm)" min="1" step="1">
        <span>×</span>
        <input type="number" class="mfg-custom-length" placeholder="Length (m)" min="1" step="1">
        <button type="button" class="btn-mfg-custom">Calculate</button>
      </div>

      <div class="unfulfilled-action-row">
        <button type="button" class="btn-manufacture-all" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            <path d="M4.93 4.93a10 10 0 0 0 0 14.14"></path>
          </svg>
          Add Selected Rolls to Inventory &amp; Re-Plan
        </button>
        <span class="unfulfilled-action-note">Rolls will be tagged as ⚙ To Manufacture with the next free MR-xxx IDs</span>
      </div>
    `;

    // Show the panel on the inputs page, right below the Calculate / Re-Plan buttons
    const actionRow = document.querySelector(".input-panel .submit-action-row");
    if (actionRow) actionRow.after(panel);
    else if (planContainer.parentElement) planContainer.after(panel);

    // Plan page: one-line notice pointing to the panel
    if (actionRow) {
      const notice = document.createElement("div");
      notice.className = "unfulfilled-plan-notice";
      notice.innerHTML = `
        <span>⚠ ${totalPieces} piece${totalPieces > 1 ? "s" : ""}${material ? ` of material ${material}` : ""} not covered by stock — add master rolls on the Inputs page.</span>
        <button type="button" class="btn-goto-unfulfilled">Go to Inputs →</button>
      `;
      notice.querySelector(".btn-goto-unfulfilled").addEventListener("click", () => {
        switchToInputsView();
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      planContainer.before(notice);
    }

    const optionsBody = panel.querySelector(".mfg-options-body");
    const mixBox = panel.querySelector(".mfg-mix-box");
    const wasteHint = panel.querySelector(".mfg-waste-hint");
    const btnManufacture = panel.querySelector(".btn-manufacture-all");
    const btnCustom = panel.querySelector(".btn-mfg-custom");
    const customW = panel.querySelector(".mfg-custom-width");
    const customL = panel.querySelector(".mfg-custom-length");
    let options = [];          // suggestions from backend (stock sizes, fitted lengths, custom)
    const checked = new Set(); // indices of ticked sizes
    let mix = null;            // combined plan for the ticked sizes (2+ ticked)
    let mixLoading = false;
    let mixReq = 0;            // ignore stale responses when ticks change quickly
    let evalReq = 0, evalTimer = null;
    const sizeKey = (o) => `${o.width}_${o.length}`;

    function fetchSuggestions(candidates, extra = {}) {
      return fetch("/api/suggest-rolls-2d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: pending, candidates, ...extra })
      }).then((res) => res.json().then((data) => {
        if (!res.ok || data.error) throw new Error(data.error || "Suggestion request failed.");
        return data;
      }));
    }

    // Rolls to make per size for the current selection
    function selectedRolls() {
      if (checked.size >= 2) return mix ? mix.breakdown.filter((b) => b.rolls > 0) : [];
      const o = options[[...checked][0]];
      return o ? [{ width: o.width, length: o.length, rolls: Math.max(1, parseInt(o.rolls_needed, 10) || 1) }] : [];
    }

    function mixRollsFor(o) {
      const b = mix && mix.breakdown.find((x) => x.width === o.width && x.length === o.length);
      return b ? b.rolls : 0;
    }

    function coversHtml(o) {
      return o.covers_all
        ? `<span class="mfg-covers-ok">✓ All ${o.pieces_total} pieces</span>`
        : `<span class="mfg-covers-partial">${o.pieces_covered} of ${o.pieces_total} pieces${o.pieces_not_fitting ? ` (${o.pieces_not_fitting} too big for this roll)` : ""}</span>`;
    }

    function utilHtml(o) {
      if (o.evaluating) return "…";
      const pct = o.utilization_pct !== null && o.utilization_pct !== undefined ? `${o.utilization_pct}%` : "—";
      if (o.verifying) return `${pct} <span style="opacity:.7; font-size:11px;" title="Estimate shown at once; the roll count is being re-checked against a full plan">(checking…)</span>`;
      return o.edited ? `${pct} <span style="opacity:.7; font-size:11px;">(edited)</span>` : pct;
    }

    // The panel answers at once with a quick estimate, then re-asks without `quick`
    // (the counts are re-planned exactly like the real plan) and updates in place.
    let userTouched = false;   // ticks / counts changed by the user since the last load
    function quickThenVerify(candidates, extra, onQuick, onVerified, quickExtra = extra) {
      return fetchSuggestions(candidates, { ...quickExtra, quick: true }).then((data) => {
        onQuick(data);
        fetchSuggestions(candidates, extra)
          .then(onVerified)
          .catch(() => onVerified(null));
      });
    }

    // Copy verified numbers onto a row, unless the user has edited its count
    function applyVerified(o, v) {
      o.verifying = false;
      if (!v || o.edited) return;
      ["rolls_needed", "pieces_covered", "covers_all", "utilization_pct", "scrap_pct", "reusable_area", "verified"]
        .forEach((f) => { if (f in v) o[f] = v[f]; });
    }

    // Single-size row: re-plan with exactly the typed roll count, update the row in place
    const rowTimers = {};
    const rowReqs = {};
    function scheduleRowEvaluate(idx) {
      const o = options[idx];
      o.edited = true;
      o.evaluating = true;
      const row = optionsBody.querySelector(`tr[data-idx="${idx}"]`);
      if (row) row.querySelector(".mfg-util-cell").innerHTML = utilHtml(o);
      updateButton();
      clearTimeout(rowTimers[idx]);
      rowTimers[idx] = setTimeout(() => {
        const reqId = rowReqs[idx] = (rowReqs[idx] || 0) + 1;
        const inv = [{ width: o.width, length: o.length, rolls: o.rolls_needed }];
        fetchSuggestions([{ width: o.width, length: o.length }], { evaluate: true, inventory: inv })
          .then((data) => {
            if (reqId !== rowReqs[idx] || options[idx] !== o) return;
            const ev = data.evaluation || {};
            Object.assign(o, { utilization_pct: ev.utilization_pct, pieces_covered: ev.pieces_covered, covers_all: ev.covers_all });
          })
          .catch((err) => showError(`Could not check edited count: ${err.message}`))
          .finally(() => {
            if (reqId !== rowReqs[idx] || options[idx] !== o) return;
            o.evaluating = false;
            const r = optionsBody.querySelector(`tr[data-idx="${idx}"]`);
            if (r) {
              r.querySelector(".mfg-util-cell").innerHTML = utilHtml(o);
              r.querySelector(".mfg-covers-cell").innerHTML = coversHtml(o);
            }
            updateButton();
            updateHint();
          });
      }, 500);
    }

    // Warn when the chosen plan still leaves a lot of material unused
    function updateHint() {
      const shownPct = checked.size >= 2 ? (mix && mix.utilization_pct) : (options[[...checked][0]] || {}).utilization_pct;
      if (shownPct !== null && shownPct !== undefined && shownPct < 75 && !options.some((o) => o.isCustom)) {
        wasteHint.style.display = "block";
        wasteHint.textContent = `This selection has only ${shownPct}% yield (pieces ÷ master roll area) — tick more sizes to mix them, or try a custom width × length below.`;
      } else {
        wasteHint.style.display = "none";
      }
    }

    function renderOptions() {
      if (options.length === 0) {
        optionsBody.innerHTML = `<tr><td colspan="5" class="mfg-loading">No stock sizes to compare — enter a custom size below.</td></tr>`;
        mixBox.style.display = "none";
        btnManufacture.disabled = true;
        return;
      }
      const mixMode = checked.size >= 2;
      optionsBody.innerHTML = options.map((o, idx) => {
        const usable = o.rolls_needed > 0;
        const isChecked = checked.has(idx);
        const tags = (o.recommended ? ` <span class="mfg-tag-best">★ Best</span>` : "") +
                     (o.fitted ? ` <span class="mfg-tag-fitted" title="Made-to-fit size: the width × length a partly-used roll in the plan actually needs">Fitted</span>` : "") +
                     (o.from_orders ? ` <span class="mfg-tag-fitted mfg-tag-pool" title="Designed from the order pool: a jumbo width × length the pending pieces fill with no side trim">From orders</span>` : "") +
                     (o.isCustom ? ` <span class="mfg-tag-custom">Custom</span>` : "");
        // In mix mode the ticked rows show (and edit) their share of the combined plan
        const pendingMix = mixMode && isChecked && !mix;
        const qtyVal = mixMode && isChecked ? (mix ? mixRollsFor(o) : "") : o.rolls_needed;
        const qtyDisabled = !usable || (mixMode && (!isChecked || !mix));
        const qtyTitle = mixMode && isChecked ? "Rolls of this size in the combined plan" : "Rolls needed if only this size is made";
        return `
          <tr data-idx="${idx}" class="${isChecked ? "mfg-row-selected" : ""} ${usable ? "" : "mfg-row-disabled"}">
            <td style="text-align:center;">
              <input type="checkbox" class="mfg-option-check" data-idx="${idx}" ${isChecked ? "checked" : ""} ${usable ? "" : "disabled"}>
            </td>
            <td><strong>${o.width.toLocaleString()} mm × ${o.length.toLocaleString()} m</strong>${tags}</td>
            <td style="text-align:center;">
              <input type="number" class="unfulfilled-qty-input mfg-option-qty" data-idx="${idx}"
                value="${qtyVal}" ${pendingMix ? `placeholder="…"` : ""} min="${mixMode ? 0 : 1}" step="1" ${qtyDisabled ? "disabled" : ""}
                title="${qtyTitle}"> rolls
            </td>
            <td class="mfg-util-cell" style="text-align:center;" title="${o.edited ? "Material used with the roll count you entered" : "Material used if only this size is made"}">${utilHtml(o)}</td>
            <td class="mfg-covers-cell">${coversHtml(o)}</td>
          </tr>
        `;
      }).join("");

      optionsBody.querySelectorAll(".mfg-option-check").forEach((box) => {
        box.addEventListener("change", () => {
          userTouched = true;
          const idx = parseInt(box.dataset.idx, 10);
          if (box.checked) checked.add(idx); else checked.delete(idx);
          refreshMix();
        });
      });
      optionsBody.querySelectorAll(".mfg-option-qty").forEach((input) => {
        input.addEventListener("input", () => {
          if (input.value === "") return; // wait until a number is typed
          userTouched = true;
          const idx = parseInt(input.dataset.idx, 10);
          const o = options[idx];
          if (checked.size >= 2 && mix) {
            const b = mix.breakdown.find((x) => x.width === o.width && x.length === o.length);
            if (b) b.rolls = Math.max(0, parseInt(input.value, 10) || 0);
            mix.edited = true;
            scheduleEvaluate();
          } else {
            o.rolls_needed = Math.max(1, parseInt(input.value, 10) || 1);
            scheduleRowEvaluate(idx);
          }
        });
      });

      renderMixBox();
      updateButton();
      updateHint();
    }

    function renderMixBox() {
      if (checked.size < 2) { mixBox.style.display = "none"; return; }
      mixBox.style.display = "flex";
      if (mixLoading || !mix) {
        mixBox.innerHTML = `<span class="mfg-mix-title">Combined plan:</span><span class="mfg-mix-parts">${mixLoading ? "Working out the best mix of the ticked sizes…" : "Could not calculate a combined plan."}</span>`;
        return;
      }
      const parts = mix.breakdown.filter((b) => b.rolls > 0)
        .map((b) => `<strong>${b.rolls}</strong> × ${b.width.toLocaleString()} mm × ${b.length.toLocaleString()} m`).join(" + ");
      const total = mix.breakdown.reduce((sum, b) => sum + b.rolls, 0);
      const unused = mix.breakdown.filter((b) => b.rolls === 0).length;
      const covers = mix.covers_all
        ? `<span class="mfg-covers-ok">✓ All ${mix.pieces_total} pieces</span>`
        : `<span class="mfg-covers-partial">${mix.pieces_covered} of ${mix.pieces_total} pieces</span>`;
      mixBox.innerHTML = `
        <span class="mfg-mix-title">Combined plan${mix.recommended ? ` <span class="mfg-tag-best">★ Best</span>` : ""}${mix.verified && !mix.edited ? ` <span class="mfg-tag-custom" title="These counts were re-planned exactly like the real plan, then reduced while every piece still fits">✓ Checked</span>` : ""}${mix.verifying && !mix.edited ? ` <span style="opacity:.7; font-size:11px;" title="Estimate shown at once; the counts are being re-checked against a full plan">(checking…)</span>` : ""}:</span>
        <span class="mfg-mix-parts">${parts || "—"} = <strong>${total}</strong> roll${total === 1 ? "" : "s"}${unused ? ` <span style="opacity:.7;">(${unused} ticked size${unused > 1 ? "s" : ""} not needed)</span>` : ""}</span>
        ${mix.evaluating
          ? `<span>Checking your counts…</span>`
          : `<span><strong>${mix.utilization_pct ?? "—"}%</strong> yield${mix.edited ? ` <span style="opacity:.7;">(counts edited by you)</span>` : ""}</span>
             <span>${covers}</span>`}
      `;
    }

    // Re-plan with exactly the edited roll counts to get the real material use and coverage
    function scheduleEvaluate() {
      mix.evaluating = true;
      mix.recommended = false;
      renderMixBox();
      updateButton();
      clearTimeout(evalTimer);
      evalTimer = setTimeout(() => {
        const reqId = ++evalReq;
        const target = mix;
        const sizes = target.breakdown.map((b) => ({ width: b.width, length: b.length }));
        fetchSuggestions(sizes, { evaluate: true, inventory: target.breakdown })
          .then((data) => {
            if (reqId !== evalReq || target !== mix) return;
            const ev = data.evaluation || {};
            Object.assign(mix, {
              utilization_pct: ev.utilization_pct,
              pieces_covered: ev.pieces_covered,
              pieces_total: ev.pieces_total,
              covers_all: ev.covers_all
            });
          })
          .catch((err) => { if (reqId === evalReq) showError(`Could not check edited counts: ${err.message}`); })
          .finally(() => {
            if (reqId !== evalReq || target !== mix) return;
            mix.evaluating = false;
            renderMixBox();
            updateButton();
            updateHint();
          });
      }, 500);
    }

    function updateButton() {
      const total = selectedRolls().reduce((sum, b) => sum + b.rolls, 0);
      const evaluating = checked.size >= 2 ? !!(mix && mix.evaluating) : !!(options[[...checked][0]] || {}).evaluating;
      btnManufacture.disabled = total <= 0 || mixLoading || evaluating;
    }

    // Recalculate the combined plan whenever 2+ sizes are ticked
    function refreshMix() {
      mix = null;
      clearTimeout(evalTimer);
      const reqId = ++mixReq;
      if (checked.size < 2) { mixLoading = false; renderOptions(); return; }
      const sizes = [...checked].map((i) => ({ width: options[i].width, length: options[i].length }));
      mixLoading = true;
      renderOptions();
      quickThenVerify(sizes, { mix: true },
        (data) => {
          if (reqId !== mixReq) return;
          mix = data.mix;
          if (mix) mix.verifying = true;
        },
        (data) => {
          if (reqId !== mixReq || !mix) return;
          mix.verifying = false;
          // Counts the user has edited meanwhile are kept
          if (data && data.mix && !mix.edited) mix = data.mix;
          renderOptions();
        })
        .catch((err) => { if (reqId === mixReq) showError(`Could not calculate combined plan: ${err.message}`); })
        .finally(() => { if (reqId === mixReq) { mixLoading = false; renderOptions(); } });
    }

    function pickDefaultSelection(data) {
      checked.clear();
      // Auto-suggested mix beats every single size → tick the sizes it uses
      if (data.mix && data.mix.recommended) {
        data.mix.breakdown.filter((b) => b.rolls > 0).forEach((b) => {
          const idx = options.findIndex((o) => sizeKey(o) === sizeKey(b));
          if (idx >= 0) checked.add(idx);
        });
        if (checked.size >= 2) {
          mix = { ...data.mix, breakdown: data.mix.breakdown.filter((b) => b.rolls > 0) };
          return;
        }
        checked.clear();
      }
      const bestIdx = options.findIndex((o) => o.recommended);
      if (bestIdx >= 0) { checked.add(bestIdx); return; }
      // Nothing covers everything — pick the option covering the most pieces
      let maxCovered = 0, pick = -1;
      options.forEach((o, idx) => {
        if (o.rolls_needed > 0 && o.pieces_covered > maxCovered) { maxCovered = o.pieces_covered; pick = idx; }
      });
      if (pick >= 0) checked.add(pick);
    }

    if (stockSizes.length > 0) {
      optionsBody.innerHTML = `<tr><td colspan="5" class="mfg-loading">Calculating master rolls needed — trying single sizes and mixes…</td></tr>`;
      quickThenVerify(stockSizes, { mix: true, fitted: true },
        (data) => {
          options = data.suggestions || [];
          options.forEach((o) => { o.verifying = true; });
          pickDefaultSelection(data);
          if (mix) mix.verifying = true;
          renderOptions();
        },
        (data) => {
          if (data && !userTouched && !options.some((o) => o.isCustom)) {
            // Nothing changed by the user yet: take the checked result as a whole
            options = data.suggestions || [];
            mix = null;
            pickDefaultSelection(data);
          } else {
            const byKey = {};
            ((data && data.suggestions) || []).forEach((v) => { byKey[sizeKey(v)] = v; });
            options.forEach((o) => { if (!o.isCustom) applyVerified(o, byKey[sizeKey(o)]); });
            // Fitted sizes only come with the full answer
            const have = new Set(options.map(sizeKey));
            Object.values(byKey).forEach((v) => { if (!have.has(sizeKey(v))) { delete v.recommended; options.push(v); } });
            if (mix) mix.verifying = false;
          }
          renderOptions();
        },
        // The quick pass skips fitted (made-to-fit) sizes; they arrive with the full answer
        { mix: true })
        .catch((err) => {
          optionsBody.innerHTML = `<tr><td colspan="5" class="mfg-loading">Could not calculate: ${err.message}</td></tr>`;
        });
    } else {
      renderOptions();
    }

    btnCustom.addEventListener("click", () => {
      const w = parseInt(customW.value, 10);
      const l = parseInt(customL.value, 10);
      if (!w || w <= 0 || !l || l <= 0) {
        showError("Please enter a valid custom master roll width (mm) and length (m).");
        return;
      }
      btnCustom.disabled = true;
      btnCustom.textContent = "Calculating…";
      let custom = null;
      quickThenVerify([{ width: w, length: l }], {},
        (data) => {
          custom = (data.suggestions || [])[0];
          if (!custom) return;
          custom.isCustom = true;
          custom.verifying = true;
          delete custom.recommended;
          // Keep the same sizes ticked after replacing / appending the custom row
          const keepKeys = new Set([...checked].map((i) => sizeKey(options[i])));
          options = options.filter((o) => !(o.width === w && o.length === l));
          options.push(custom);
          checked.clear();
          options.forEach((o, i) => { if (keepKeys.has(sizeKey(o))) checked.add(i); });
          if (custom.rolls_needed > 0) checked.add(options.length - 1);
          refreshMix();
        },
        (data) => {
          if (!custom || !options.includes(custom)) return;
          applyVerified(custom, data && (data.suggestions || [])[0]);
          if (checked.size < 2) renderOptions();
          else {
            const r = optionsBody.querySelector(`tr[data-idx="${options.indexOf(custom)}"]`);
            if (r) {
              r.querySelector(".mfg-util-cell").innerHTML = utilHtml(custom);
              r.querySelector(".mfg-covers-cell").innerHTML = coversHtml(custom);
            }
          }
        })
        .catch((err) => showError(`Could not calculate custom size: ${err.message}`))
        .finally(() => {
          btnCustom.disabled = false;
          btnCustom.textContent = "Calculate";
        });
    });

    btnManufacture.addEventListener("click", () => {
      const toMake = selectedRolls();
      const rollsToMake = toMake.reduce((sum, b) => sum + b.rolls, 0);
      if (rollsToMake <= 0) return;

      let n = 0;
      toMake.forEach((b) => {
        for (let i = 0; i < b.rolls; i++) {
          masterRolls2D.push({
            id: `mr_2d_mfg_${Date.now()}_${n++}_${Math.random().toString(36).substr(2, 5)}`,
            roll_id: generateNextMasterRollId2D(),
            width: b.width,
            length: b.length,
            material,
            gsm: matGsm,
            qty: 1,
            isRemnant: false,
            isToProduce: true,
            consumed_orders: []
          });
        }
      });

      renderRollChips();

      // Show confirmation then auto re-plan
      btnManufacture.textContent = `✓ Added ${rollsToMake} roll${rollsToMake > 1 ? "s" : ""} — Re-Planning...`;
      btnManufacture.disabled = true;

      setTimeout(() => {
        runOptimization2D(true);
      }, 400);
    });
  }

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
      { label: "MATERIAL YIELD", val: `${summary.slitting_efficiency_pct}%`, sub: "Pieces ÷ master roll area allocated", color: "#0284c7" },
      { label: "MASTER ROLLS", val: `${summary.rolls_used} Rolls`, sub: `Allocated: ${toM2(summary.total_roll_area_allocated)} m²`, color: "#0f172a" },
      { label: "MATERIAL CUT (PLANNED)", val: `${toM2(summary.total_product_cut_area)} m²`, sub: `${plan.reduce((sum, r) => sum + r.sections.reduce((s, sec) => s + sec.cuts.reduce((csum, c) => csum + c.quantity, 0), 0), 0)} pieces`, color: "#0f172a" },
      { label: "SCRAP (NOT REUSABLE)", val: `${summary.net_scrap_pct}%`, sub: `${toM2(summary.net_scrap_area)} m² scrap • reusable leftover ${(Math.max(0, 100 - summary.slitting_efficiency_pct - summary.net_scrap_pct)).toFixed(2)}% • = 100% with yield`, color: "#dc2626" }
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

      const orderPills = orderList.map((o) => `${o.width}mm × ${o.length}m (${o.quantity} pcs)`).join("   •   ");
      ctx.fillStyle = "#334155";
      ctx.font = "12px 'SF Mono', Consolas, Monaco, monospace";
      ctx.fillText(orderPills, padding + 16, y + 44);

      const totalDemandArea = orderList.reduce((sum, o) => sum + (o.width * o.length * o.quantity), 0);
      const totalDemandRolls = orderList.reduce((sum, o) => sum + o.quantity, 0);
      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Total Orders: ${toM2(totalDemandArea)} m² (${totalDemandRolls} pieces total)`, padding + 16, y + 64);

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
      ctx.fillText(rollYieldText(roll, " · "), canvasWidth - padding - 18, y + 26);
      ctx.textAlign = "left";

      // Length Utilization Track Bar
      const pctUsed = Math.min(100, Math.round((roll.length_used / roll.master_length) * 100));
      const pctRem = Math.max(0, 100 - pctUsed);
      const trackX = padding + 18;
      let currY = y + 42;
      const trackW = canvasWidth - padding * 2 - 36;

      ctx.fillStyle = "#64748b";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(`Master Length Used: ${roll.length_used.toLocaleString()} m (${pctUsed}%)`, trackX, currY + 12);
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
        const wb = runWasteBreakdown(sec, roll.master_width);
        ctx.fillText(`Width: ${sec.used_width_mm.toLocaleString()} / ${roll.master_width.toLocaleString()} mm  •  Side Trim: ${sec.width_waste_mm} mm (${wb.trimPct}%)${wb.hasTail ? `  •  Length Tail: ${wb.tailPct}%` : ""}  •  Run Waste: ${wb.totalPct}%`, trackX + trackW - 12, currY + 20);
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
          const stack = cut.stack || 1;
          for (let p = 0; p < Math.ceil(cut.quantity / stack); p++) {
            const laneW = (cut.width / roll.master_width) * barInnerW;
            ctx.fillStyle = color;
            ctx.fillRect(laneX, slitBarY, laneW, slitBarH);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.strokeRect(laneX, slitBarY, laneW, slitBarH);

            if (laneW > 28) {
              ctx.fillStyle = "#ffffff";
              ctx.font = "bold 11px 'SF Mono', Consolas, Monaco, monospace";
              ctx.textAlign = "center";
              ctx.fillText(`${cut.width}`, laneX + laneW / 2, slitBarY + (stack > 1 ? 16 : 22));
              if (stack > 1) {
                ctx.font = "9px 'SF Mono', Consolas, Monaco, monospace";
                ctx.fillText(`${stack}×${cut.length}m`, laneX + laneW / 2, slitBarY + 29);
              }
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
        const byOrder = {};
        (sec._consumedAssignments || []).forEach((a) => {
          const k = `${orderRef(a)}|${a.width}|${a.length}`;
          if (!byOrder[k]) byOrder[k] = { ...a, qty: 0 };
          byOrder[k].qty += a.qty;
        });
        const manifestText = Object.keys(byOrder).length
          ? Object.values(byOrder).map((a) => `${orderRef(a)}${a.customer ? ` ${a.customer}` : ""}: ${a.width}mm × ${a.length}m ×${a.qty}`).join("   |   ")
          : sec.cuts.map((c) => `${c.width}mm × ${c.length}m (×${c.quantity} pcs${c.stack > 1 ? `, ${c.stack} per lane` : ""})`).join("   |   ");
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

  // ── 2D Excel workbook (ERP / SAP-style) ─────────────────────────────────
  // Sheets: Summary · Order Fulfilment · Cut Roll Register · Master Roll Usage ·
  // Cutting Pattern · Leftovers & Scrap · Not Covered · Model Trials.
  // Areas in m² (mm × m ÷ 1000), weights in kg (m² × GSM ÷ 1000). Numbers are written
  // as numbers so the sheets can be imported into an ERP.
  function downloadExplorationSpreadsheet2D() {
    if (!latestPlanData2D || !latestPlanData2D.plan || latestPlanData2D.plan.length === 0) return;
    if (typeof XLSX === "undefined") return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const filename = `RollCut_2D_Production_Plan_${dateStr}.xlsx`;
    const plan = latestPlanData2D.plan;
    const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const m2 = (mmTimesM) => r2(mmTimesM / 1000);
    const kg = (areaM2, gsm) => (gsm ? r2((areaM2 * gsm) / 1000) : "");
    const OFFCUT_MIN_MM = 150;

    // GSM: from the inventory roll, else any roll of the same material
    const gsmByMat = {};
    masterRolls2D.forEach((r) => { const m = normMat(r.material); if (r.gsm && !gsmByMat[m]) gsmByMat[m] = r.gsm; });
    const invOf = (roll) => masterRolls2D.find((x) => x.roll_id && x.roll_id === roll.master_roll_id) || null;
    const gsmOf = (roll) => { const inv = invOf(roll); return (inv && inv.gsm) || gsmByMat[normMat(roll.material)] || null; };
    const isCut = (roll) => completedRollIds2D.has(roll.uid);
    const mrId = (roll) => roll.master_roll_id || `Plan roll #${roll.roll_num}`;
    const sourceOf = (roll) => {
      const inv = invOf(roll);
      if (!inv) return "Stock";
      if (inv.isRemnant) return `Leftover of ${inv.parentRollId || "earlier roll"}`;
      if (inv.isToProduce) return "Manufactured (new)";
      return "Stock";
    };

    // Per-roll material balance (all mm·m): roll = pieces + scrap + reusable leftover
    const rollBalance = (roll) => {
      let sideScrap = 0, tailScrap = 0, offcut = 0;
      roll.sections.forEach((s) => {
        const side = s.width_waste_mm * s.section_length;
        const tails = Math.max(0, s.waste_area - side);
        tailScrap += tails;
        if (s.width_waste_mm >= OFFCUT_MIN_MM) offcut += side; else sideScrap += side;
      });
      const uncut = roll.master_width * roll.remnant_length;
      const pieces = roll.total_used_area;
      const total = roll.master_width * roll.master_length;
      return { total, pieces, sideScrap, tailScrap, offcut, uncut, diff: total - pieces - sideScrap - tailScrap - offcut - uncut };
    };

    // ── Piece register: one row per customer piece, with lane / knife position ──
    const pieceRows = [];
    plan.forEach((roll) => {
      const gsm = gsmOf(roll);
      roll.sections.forEach((sec, sIdx) => {
        const queue = (sec._consumedAssignments || []).map((a) => ({ ...a, left: a.qty }));
        const takeOrder = (w, l) => {
          const a = queue.find((x) => x.width === w && x.length === l && x.left > 0);
          if (!a) return null;
          a.left -= 1;
          return a;
        };
        let lane = 0, edge = 0;
        sec.cuts.forEach((cut) => {
          const stack = cut.stack || 1;
          const lanes = Math.ceil(cut.quantity / stack);
          let remaining = cut.quantity;
          for (let li = 0; li < lanes; li++) {
            lane += 1;
            const inLane = Math.min(stack, remaining);
            remaining -= inLane;
            for (let k = 1; k <= inLane; k++) {
              const ord = takeOrder(cut.width, cut.length);
              const area = m2(cut.width * cut.length);
              pieceRows.push({
                id: `${mrId(roll)}-S${sIdx + 1}-L${String(lane).padStart(2, "0")}${stack > 1 ? `-P${k}` : ""}`,
                roll, sIdx, lane, edgeFrom: edge, edgeTo: edge + cut.width, posInLane: stack > 1 ? `${k} of ${inLane}` : "",
                width: cut.width, length: cut.length, area, gsm, weight: kg(area, gsm),
                order: ord
              });
            }
            edge += cut.width;
          }
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    // ── Sheet 2: Order Fulfilment (built first; Summary uses its totals) ──
    const lines = new Map();
    const lineKey = (mat, oid, w, l) => `${normMat(mat)}|${oid}|${w}|${l}`;
    const getLine = (mat, oid, w, l) => {
      const k = lineKey(mat, oid, w, l);
      if (!lines.has(k)) lines.set(k, { material: normMat(mat), order_id: oid, item: "", customer: "", width: w, length: l, order_date: "", delivery_date: "", table: 0, cut: 0, planned: 0, defective: 0, rolls: new Set() });
      return lines.get(k);
    };
    ordersTbody.querySelectorAll("tr").forEach((r) => {
      const g = (c) => (r.querySelector(c) ? r.querySelector(c).value : "");
      const w = parseInt(g(".order-width"), 10), l = parseInt(g(".order-length"), 10), q = parseInt(g(".order-qty"), 10);
      if (!(w > 0 && l > 0 && q > 0)) return;
      const line = getLine(g(".order-material"), g(".order-id").trim() || "—", w, l);
      line.table += q;
      line.item = line.item || g(".order-item");
      line.customer = line.customer || g(".order-customer").trim();
      line.order_date = line.order_date || g(".order-date");
      line.delivery_date = line.delivery_date || g(".delivery-date");
    });
    plan.forEach((roll) => {
      (roll._consumedAssignments || []).forEach((a) => {
        const line = getLine(a.material || roll.material, a.order_id || "—", a.width, a.length);
        if (isCut(roll)) line.cut += a.qty; else line.planned += a.qty;
        line.rolls.add(mrId(roll));
        line.customer = line.customer || a.customer || "";
        line.item = line.item || a.item || "";
        line.order_date = line.order_date || a.order_date || "";
        line.delivery_date = line.delivery_date || a.delivery_date || "";
      });
    });
    // Defective pieces (Defect +1 on a cut roll) were put back into demand as re-orders
    plan.forEach((roll) => {
      (roll._defects || []).forEach((d) => {
        getLine(d.material || roll.material, d.order_id || "—", d.width, d.length).defective += d.qty || 1;
      });
    });
    const orderRows = [[
      "Order ID", "Item", "Customer", "Material", "Width (mm)", "Length (m)", "Order Date", "Delivery Date",
      "Qty Ordered (pcs)", "Qty Cut (pcs)", "of which Defective, re-ordered (pcs)", "Qty Planned, not yet cut (pcs)", "Qty Not Covered (pcs)",
      "Area per Piece (m²)", "Area Ordered (m²)", "Area Cut (m²)", "Area Planned (m²)", "Area Not Covered (m²)",
      "GSM (g/m²)", "Weight Ordered (kg)", "Weight Cut (kg)", "Master Rolls (IDs)", "Status"
    ]];
    const tot = { ordered: 0, cut: 0, defective: 0, planned: 0, open: 0, aOrd: 0, aCut: 0, aPlan: 0, aOpen: 0, kgOrd: 0, kgCut: 0 };
    [...lines.values()]
      .sort((a, b) => String(a.order_id).localeCompare(String(b.order_id), undefined, { numeric: true }) || (Number(a.item) || 0) - (Number(b.item) || 0) || a.width - b.width || a.length - b.length)
      .forEach((ln) => {
        // The table holds what is still to cut, including re-orders for defective pieces
        const ordered = Math.max(0, ln.table + ln.cut - ln.defective);
        const good = ln.cut - ln.defective;
        const open = Math.max(0, ln.table - ln.planned);
        const per = m2(ln.width * ln.length);
        const gsm = gsmByMat[ln.material] || null;
        const status = ln.order_id === "—" ? "Piece without order line"
          : ordered > 0 && good >= ordered ? "Complete"
          : open === 0 ? (ln.cut > 0 ? "Part cut, rest planned" : "Planned")
          : (ln.cut + ln.planned > 0 ? "Partly covered" : "Not covered");
        orderRows.push([
          ln.order_id, ln.item ? Number(ln.item) : "", ln.customer || "", ln.material || "—", ln.width, ln.length, ln.order_date || "", ln.delivery_date || "",
          ordered, ln.cut, ln.defective, ln.planned, open,
          per, r2(per * ordered), r2(per * ln.cut), r2(per * ln.planned), r2(per * open),
          gsm || "", kg(per * ordered, gsm), kg(per * ln.cut, gsm), [...ln.rolls].join(", "), status
        ]);
        tot.ordered += ordered; tot.cut += ln.cut; tot.defective += ln.defective; tot.planned += ln.planned; tot.open += open;
        tot.aOrd += per * ordered; tot.aCut += per * ln.cut; tot.aPlan += per * ln.planned; tot.aOpen += per * open;
        if (gsm) { tot.kgOrd += (per * ordered * gsm) / 1000; tot.kgCut += (per * ln.cut * gsm) / 1000; }
      });
    orderRows.push([]);
    orderRows.push(["TOTAL", "", "", "", "", "", "", "", tot.ordered, tot.cut, tot.defective, tot.planned, tot.open, "",
      r2(tot.aOrd), r2(tot.aCut), r2(tot.aPlan), r2(tot.aOpen), "", r2(tot.kgOrd), r2(tot.kgCut), "", ""]);

    // ── Sheet 4 data: Master Roll Usage ──
    const usageRows = [[
      "Plan Roll #", "Master Roll ID", "Material", "GSM (g/m²)", "Source", "Status",
      "Width (mm)", "Length (m)", "Length Run (m)", "Uncut Length (m)", "Roll Area (m²)", "Roll Weight (kg)",
      "Pieces (count)", "Pieces Area (m²)", "Pieces Weight (kg)",
      "Scrap: Side Trim < 150 mm (m²)", "Scrap: Length Tails (m²)", "Reusable Side Offcut ≥ 150 mm (m²)", "Uncut Leftover (m²)",
      "Leftover Roll IDs Created", "Orders on Roll (Order/Item · Customer)", "Run Yield % (pieces ÷ area run)", "Material Yield % (pieces ÷ roll area)", "Balance Check (m², should be 0)"
    ]];
    const matTot = {};
    plan.forEach((roll) => {
      const b = rollBalance(roll);
      const gsm = gsmOf(roll);
      const pieces = pieceRows.filter((p) => p.roll === roll).length;
      const leftoverIds = masterRolls2D.filter((x) => x.sourceRollUid === roll.uid && x.roll_id).map((x) => x.roll_id).join(", ");
      const runArea = roll.master_width * roll.length_used;
      usageRows.push([
        roll.roll_num, mrId(roll), normMat(roll.material) || "—", gsm || "", sourceOf(roll), isCut(roll) ? "Cut" : "Planned",
        roll.master_width, roll.master_length, roll.length_used, roll.remnant_length, m2(b.total), kg(m2(b.total), gsm),
        pieces, m2(b.pieces), kg(m2(b.pieces), gsm),
        m2(b.sideScrap), m2(b.tailScrap), m2(b.offcut), m2(b.uncut),
        leftoverIds,
        [...new Set((roll._consumedAssignments || []).map((a) => `${orderRef(a)}${a.customer ? ` · ${a.customer}` : ""}`))].join(", "),
        runArea ? r2((b.pieces / runArea) * 100) : 0, b.total ? r2((b.pieces / b.total) * 100) : 0, m2(b.diff)
      ]);
      const mk = normMat(roll.material) || "—";
      const t = matTot[mk] || (matTot[mk] = { rolls: 0, cut: 0, total: 0, pieces: 0, side: 0, tail: 0, offcut: 0, uncut: 0, kgTotal: 0, kgPieces: 0, nPieces: 0, gsm });
      t.rolls += 1; if (isCut(roll)) t.cut += 1;
      t.total += b.total; t.pieces += b.pieces; t.side += b.sideScrap; t.tail += b.tailScrap; t.offcut += b.offcut; t.uncut += b.uncut;
      t.nPieces += pieces;
      if (gsm) { t.kgTotal += (b.total / 1000) * gsm / 1000; t.kgPieces += (b.pieces / 1000) * gsm / 1000; }
    });

    // ── Sheet 1: Summary ──
    const summaryRows = [
      ["RollCut OS — 2D Production Plan"],
      ["Generated", now.toLocaleString()],
      ["Units", "Width mm · Length m · Area m² (mm × m ÷ 1000) · Weight kg (m² × GSM ÷ 1000)"],
      ["Note", "Rolls cut from leftovers of earlier rolls are listed as their own master rolls (Source = Leftover of …)."],
      [],
      ["Material", "Master Rolls Planned", "of which Cut", "Master Roll Area (m²)", "Master Roll Weight (kg)",
        "Pieces", "Pieces Area (m²)", "Pieces Weight (kg)", "Scrap: Side Trim (m²)", "Scrap: Length Tails (m²)",
        "Reusable Offcut (m²)", "Uncut Leftover (m²)", "Material Yield %", "Scrap %", "Balance Check (m²)"]
    ];
    const grand = { rolls: 0, cut: 0, total: 0, pieces: 0, side: 0, tail: 0, offcut: 0, uncut: 0, kgTotal: 0, kgPieces: 0, nPieces: 0 };
    Object.entries(matTot).sort().forEach(([mk, t]) => {
      const scrap = t.side + t.tail;
      summaryRows.push([mk, t.rolls, t.cut, m2(t.total), t.kgTotal ? r2(t.kgTotal) : "", t.nPieces, m2(t.pieces), t.kgPieces ? r2(t.kgPieces) : "",
        m2(t.side), m2(t.tail), m2(t.offcut), m2(t.uncut),
        t.total ? r2((t.pieces / t.total) * 100) : 0, t.total ? r2((scrap / t.total) * 100) : 0,
        m2(t.total - t.pieces - scrap - t.offcut - t.uncut)]);
      Object.keys(grand).forEach((k) => { grand[k] += t[k] || 0; });
    });
    const gScrap = grand.side + grand.tail;
    summaryRows.push(["ALL MATERIALS", grand.rolls, grand.cut, m2(grand.total), grand.kgTotal ? r2(grand.kgTotal) : "", grand.nPieces, m2(grand.pieces), grand.kgPieces ? r2(grand.kgPieces) : "",
      m2(grand.side), m2(grand.tail), m2(grand.offcut), m2(grand.uncut),
      grand.total ? r2((grand.pieces / grand.total) * 100) : 0, grand.total ? r2((gScrap / grand.total) * 100) : 0,
      m2(grand.total - grand.pieces - gScrap - grand.offcut - grand.uncut)]);
    summaryRows.push([]);
    summaryRows.push(["Order pieces", "Ordered", "Cut", "of which Defective", "Planned, not yet cut", "Not covered"]);
    summaryRows.push(["Pieces", tot.ordered, tot.cut, tot.defective, tot.planned, tot.open]);
    summaryRows.push(["Area (m²)", r2(tot.aOrd), r2(tot.aCut), "", r2(tot.aPlan), r2(tot.aOpen)]);
    if (latestPlanData2D.prioritized) summaryRows.push(["Note", "Not enough master rolls for all orders — orders with the earliest delivery dates were planned first."]);
    addSheet("Summary", summaryRows, [22, 18, 12, 18, 18, 10, 16, 16, 18, 18, 16, 16, 14, 10, 16]);
    addSheet("Order Fulfilment", orderRows, [12, 7, 20, 12, 10, 10, 12, 12, 12, 10, 14, 14, 12, 12, 14, 12, 12, 14, 10, 14, 12, 30, 22]);

    // ── Sheet 3: Cut Roll Register ──
    const regRows = [[
      "Piece ID", "Master Roll ID", "Plan Roll #", "Material", "GSM (g/m²)", "Run #", "Lane # (from edge)",
      "Knife From (mm)", "Knife To (mm)", "Position in Lane", "Width (mm)", "Length (m)", "Area (m²)", "Weight (kg)",
      "Order ID", "Item", "Customer", "Order Date", "Delivery Date", "Status"
    ]];
    // Mark defective pieces: one piece per recorded defect, same roll / order / size
    const defectLeft = new Map();
    plan.forEach((roll) => (roll._defects || []).forEach((d) => {
      const k = `${roll.uid}|${d.order_id}|${d.width}|${d.length}`;
      defectLeft.set(k, (defectLeft.get(k) || 0) + (d.qty || 1));
    }));
    pieceRows.forEach((p) => {
      const dk = `${p.roll.uid}|${p.order ? p.order.order_id : "—"}|${p.width}|${p.length}`;
      p.defect = false;
      if ((defectLeft.get(dk) || 0) > 0) { p.defect = true; defectLeft.set(dk, defectLeft.get(dk) - 1); }
    });
    pieceRows.forEach((p) => {
      regRows.push([
        p.id, mrId(p.roll), p.roll.roll_num, normMat(p.roll.material) || "—", p.gsm || "", p.sIdx + 1, p.lane,
        p.edgeFrom, p.edgeTo, p.posInLane, p.width, p.length, p.area, p.weight,
        p.order ? p.order.order_id : "—", p.order && p.order.item ? Number(p.order.item) : "", p.order ? p.order.customer || "" : "", p.order ? p.order.order_date || "" : "", p.order ? p.order.delivery_date || "" : "",
        p.defect ? "Cut — DEFECTIVE (re-ordered)" : (isCut(p.roll) ? "Cut" : "Planned")
      ]);
    });
    addSheet("Cut Roll Register", regRows, [24, 14, 10, 12, 10, 7, 10, 10, 10, 12, 10, 10, 10, 10, 12, 7, 20, 12, 12, 26]);
    addSheet("Master Roll Usage", usageRows, [10, 14, 12, 10, 22, 9, 10, 10, 12, 12, 12, 12, 10, 14, 14, 18, 16, 18, 16, 22, 36, 16, 18, 16]);

    // ── Sheet 5: Cutting Pattern / Knife Settings ──
    const patRows = [[
      "Plan Roll #", "Master Roll ID", "Material", "Run #", "Run Length (m)", "Lanes", "Lane Widths (mm, from edge)",
      "Knife Positions (mm from edge)", "Lane Orders (Order/Item, from edge)", "Used Width (mm)", "Side Trim (mm)", "Stacked Lanes (pieces end-to-end)", "Status"
    ]];
    plan.forEach((roll) => {
      roll.sections.forEach((sec, sIdx) => {
        const widths = [], stacked = [];
        sec.cuts.forEach((c) => {
          const stack = c.stack || 1;
          for (let i = 0; i < Math.ceil(c.quantity / stack); i++) widths.push(c.width);
          if (stack > 1) stacked.push(`${c.width}mm: ${stack} × ${c.length}m per lane`);
        });
        let pos = 0;
        const knives = [0, ...widths.map((w) => (pos += w))];
        const laneOrders = {};
        pieceRows.filter((p) => p.roll === roll && p.sIdx === sIdx).forEach((p) => {
          (laneOrders[p.lane] = laneOrders[p.lane] || []).push(p.order ? orderRef(p.order) : "—");
        });
        const laneOrderText = Object.keys(laneOrders).sort((a, b) => a - b).map((l) => laneOrders[l].join("+")).join(" | ");
        patRows.push([
          roll.roll_num, mrId(roll), normMat(roll.material) || "—", sIdx + 1, sec.section_length, widths.length,
          widths.join(" | "), knives.join(", "), laneOrderText, sec.used_width_mm, sec.width_waste_mm, stacked.join("; "), isCut(roll) ? "Cut" : "Planned"
        ]);
      });
    });
    addSheet("Cutting Pattern", patRows, [10, 14, 12, 7, 12, 7, 40, 50, 50, 12, 12, 34, 9]);

    // ── Sheet 6: Leftovers & Scrap ──
    const lsRows = [[
      "From Plan Roll #", "From Master Roll ID", "Material", "Type", "Width (mm)", "Length (m)", "Area (m²)", "Weight (kg)",
      "Reusable?", "Leftover Roll ID", "Status"
    ]];
    plan.forEach((roll) => {
      const gsm = gsmOf(roll);
      const mat = normMat(roll.material) || "—";
      const leftoverStatus = (w, l) => {
        const inv = masterRolls2D.find((x) => x.sourceRollUid === roll.uid && x.width === w && x.length === l);
        if (!inv) return ["", "Not added to stock"];
        const recut = plan.find((p) => p.master_roll_id && p.master_roll_id === inv.roll_id);
        return [inv.roll_id || "", recut ? `Re-cut in plan roll #${recut.roll_num}` : (inv.qty !== null && inv.qty <= 0 ? "Used" : "In stock")];
      };
      if (roll.remnant_length > 0) {
        const a = m2(roll.master_width * roll.remnant_length);
        lsRows.push([roll.roll_num, mrId(roll), mat, "Uncut leftover (length)", roll.master_width, roll.remnant_length, a, kg(a, gsm), "Yes", ...leftoverStatus(roll.master_width, roll.remnant_length)]);
      }
      let sideScrap = 0, tails = 0;
      roll.sections.forEach((s, sIdx) => {
        const side = s.width_waste_mm * s.section_length;
        tails += Math.max(0, s.waste_area - side);
        if (s.width_waste_mm >= OFFCUT_MIN_MM) {
          const a = m2(side);
          lsRows.push([roll.roll_num, mrId(roll), mat, `Side offcut (run #${sIdx + 1})`, s.width_waste_mm, s.section_length, a, kg(a, gsm), "Yes", ...leftoverStatus(s.width_waste_mm, s.section_length)]);
        } else sideScrap += side;
      });
      if (sideScrap > 0) lsRows.push([roll.roll_num, mrId(roll), mat, "Scrap — side trim < 150 mm", "", "", m2(sideScrap), kg(m2(sideScrap), gsm), "No", "", "Scrap"]);
      if (tails > 0) lsRows.push([roll.roll_num, mrId(roll), mat, "Scrap — length tails", "", "", m2(tails), kg(m2(tails), gsm), "No", "", "Scrap"]);
    });
    addSheet("Leftovers & Scrap", lsRows, [10, 14, 12, 28, 10, 10, 10, 10, 9, 14, 24]);

    // ── Sheet 7: Not Covered ──
    const ncRows = [["Material", "Width (mm)", "Length (m)", "Qty Not Covered (pcs)", "Area (m²)", "GSM (g/m²)", "Weight (kg)", "Order / Item", "Customers", "Earliest Delivery", "Action"]];
    const openByOrder = [...lines.values()].filter((ln) => ln.order_id !== "—" && Math.max(0, ln.table - ln.planned) > 0);
    (latestPlanData2D.unfulfilled_orders || []).forEach((o) => {
      const mat = normMat(o.material);
      const a = m2(o.width * o.length * o.quantity);
      const gsm = gsmByMat[mat] || null;
      const open = openByOrder.filter((ln) => ln.material === mat && ln.width === o.width && ln.length === o.length);
      const ids = open.map((ln) => (ln.item ? `${ln.order_id}/${ln.item}` : ln.order_id));
      const custs = open.map((ln) => ln.customer).filter(Boolean);
      const firstDue = open.map((ln) => ln.delivery_date).filter(Boolean).sort()[0] || "";
      ncRows.push([mat || "—", o.width, o.length, o.quantity, a, gsm || "", kg(a, gsm), [...new Set(ids)].join(", "), [...new Set(custs)].join(", "), firstDue, "Needs more master rolls"]);
    });
    if (ncRows.length === 1) ncRows.push(["All order pieces are covered by the plan"]);
    addSheet("Not Covered", ncRows, [12, 10, 10, 18, 10, 10, 10, 24, 24, 14, 24]);

    // ── Sheet 8: Model Trials ──
    const trialsRows = [[
      "Plan Roll #", "Master Roll ID", "Master Roll Size", "Decision", "Run #", "Run Length (m)",
      "Lane Combination", "Used Width (mm)", "Side Trim (mm)", "Run Waste %", "Run Yield %"
    ]];
    plan.forEach((roll) => {
      const trials = roll.candidates_explored || [];
      trials.forEach((t, idx) => {
        trialsRows.push([
          roll.roll_num, mrId(roll), `${roll.master_width}mm × ${roll.master_length}m`,
          t.is_chosen ? "✓ SELECTED" : `Alternative #${idx + 1}`, t.run_idx || 1, t.section_length,
          t.pattern, t.used_width_mm, t.width_waste_mm, t.waste_area_pct, t.yield_pct
        ]);
      });
      if (trials.length > 0) trialsRows.push([]);
    });
    addSheet("Model Trials", trialsRows, [10, 14, 18, 16, 7, 12, 60, 12, 12, 10, 10]);

    XLSX.writeFile(wb, filename);
  }

  if (btnExportTrials) {
    btnExportTrials.addEventListener("click", downloadExplorationSpreadsheet);
  }

  // --- Cancel Plan ---
  // Discards the current plan when it is not good enough. Rolls already marked as Cut are real
  // production, so they stay (with their stock and order deductions). Everything else is undone:
  // uncut "To Manufacture" rolls are removed, which frees their IDs for the next new roll, and
  // remnants promised by uncut rolls are taken back out of stock. Stock and order quantities
  // are only deducted on "Mark as Cut", so uncut rolls need no further restoring.
  function cancelCurrentPlan() {
    const is2D = currentMode === "2d";
    const data = is2D ? latestPlanData2D : latestPlanData;
    if (!data || !data.plan) return;
    const done = is2D ? completedRollIds2D : completedRollIds;
    const cutRolls = data.plan.filter((r) => done.has(r.uid));
    const inventory = is2D ? masterRolls2D : masterRolls;
    const mfgToRemove = inventory.filter((r) => r.isToProduce && !isPhysicalRoll(r));

    const lines = ["Cancel this cutting plan?", ""];
    if (cutRolls.length) lines.push(`• ${cutRolls.length} roll${cutRolls.length > 1 ? "s" : ""} already marked as Cut will be kept.`);
    lines.push("• All uncut rolls are released back to stock.");
    if (mfgToRemove.length) {
      lines.push(`• ${mfgToRemove.length} "To Manufacture" roll${mfgToRemove.length > 1 ? "s" : ""} (${mfgToRemove.map((r) => r.roll_id).join(", ")}) will be removed; their IDs will be reused.`);
    }
    if (!window.confirm(lines.join("\n"))) return;

    if (is2D) {
      cleanupUncutRemnants2D();
      masterRolls2D = masterRolls2D.filter((r) => !mfgToRemove.includes(r));
    } else {
      cleanupUncutRemnants1D();
      masterRolls = masterRolls.filter((r) => !mfgToRemove.includes(r));
    }
    document.querySelectorAll(".unfulfilled-panel, .unfulfilled-plan-notice").forEach((el) => el.remove());

    if (cutRolls.length) {
      // Keep only the cut rolls as the record of what was actually produced (original roll numbers kept)
      if (is2D) {
        latestPlanData2D = {
          summary: computePlanSummary2D(cutRolls),
          plan: cutRolls,
          unfulfilled_orders: [],
          prioritized: !!data.prioritized
        };
        renderRollChips();
        renderPlanResults2D(latestPlanData2D);
      } else {
        const used = cutRolls.reduce((acc, r) => acc + r.used_mm, 0);
        const capacity = cutRolls.reduce((acc, r) => acc + r.roll_width, 0);
        latestPlanData = {
          summary: {
            rolls_used: cutRolls.length,
            total_demand_mm: used,
            total_capacity_mm: capacity,
            total_used_mm: used,
            total_waste_mm: cutRolls.reduce((acc, r) => acc + r.waste_mm, 0),
            efficiency_pct: roundToTwo((used / capacity) * 100)
          },
          plan: cutRolls,
          unfulfilled_orders: []
        };
        renderRollChips();
        renderPlanResults(latestPlanData);
      }
    } else {
      if (is2D) {
        latestPlanData2D = null;
        completedRollIds2D.clear();
      } else {
        latestPlanData = null;
        completedRollIds.clear();
      }
      emptyState.style.display = "flex";
      planContainer.style.display = "none";
      kpiSection.style.display = "none";
      planStatusNote.textContent = "Awaiting calculation";
      btnExportImg.style.display = "none";
      btnPrint.style.display = "none";
      if (btnExportTrials) btnExportTrials.style.display = "none";
      if (exportOptionsBar) exportOptionsBar.style.display = "none";
      if (btnReoptimize) btnReoptimize.style.display = "none";
      if (btnCancelPlan) btnCancelPlan.style.display = "none";
      if (document.getElementById("btn-view-plan")) {
        document.getElementById("btn-view-plan").style.display = "none";
      }
      renderRollChips();
    }
    switchToInputsView();
  }

  if (btnCancelPlan) {
    btnCancelPlan.addEventListener("click", cancelCurrentPlan);
  }

  // --- View Switching Logic ---
  function switchToPlanView() {
    document.querySelector(".input-panel").style.display = "none";
    document.querySelector(".output-panel").style.display = "flex";
    if (document.getElementById("btn-view-plan")) {
      document.getElementById("btn-view-plan").style.display = "block";
    }
  }

  function switchToInputsView() {
    document.querySelector(".output-panel").style.display = "none";
    document.querySelector(".input-panel").style.display = "flex";
  }

  const btnViewPlan = document.getElementById("btn-view-plan");
  if (btnViewPlan) {
    btnViewPlan.addEventListener("click", switchToPlanView);
  }

  const btnBackInputs = document.getElementById("btn-back-inputs");
  if (btnBackInputs) {
    btnBackInputs.addEventListener("click", switchToInputsView);
  }

  // --- Initial Setup ---
  try {
    localStorage.clear();
  } catch (e) { }

  createOrderRow();
  renderRollChips();
  updateDemandCalculation();
});
