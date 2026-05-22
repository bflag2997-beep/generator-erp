let state = null;
let openingLines = [];
let currentLedger = null;
let saleLines = [];
let dashboard = null;
let usersPermissions = null;
let selectedLedgerAccountCode = "";
let selectedAccountContext = null;
let inventoryTraceReport = null;
let accountTreeExpanded = new Set();
let accountCodeValidationOk = true;
let financialReports = null;
let companyLogoData = null;

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 0 }).format(Number(value || 0));
const esc = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const emptyRow = "<tr><td>لا توجد بيانات</td></tr>";
function notify(message, type = "ok") {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

const moduleIds = [
  "homePanel",
  "dashboardCards",
  "salesWorkflowPanel",
  "customerForm",
  "supplierForm",
  "itemForm",
  "receiptForm",
  "openingJournalForm",
  "openingInventoryForm",
  "payrollForm",
  "maintenanceRevenueForm",
  "fixedAssetForm",
  "auditPanel",
  "invoiceTemplateForm",
  "usersPermissionsPanel",
  "accountsPanel",
  "inventoryTracePanel",
  "financialReportsPanel",
  "ledgerPanel",
  "registeredData"
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMap = {
      UNAUTHENTICATED: "انتهت جلستك. أعد تسجيل الدخول.",
      FORBIDDEN: "ليس لديك صلاحية لهذا الإجراء.",
      ACCOUNT_LOCKED: "تم قفل الحساب بعد محاولات دخول متعددة. تواصل مع الأدمن.",
      INVALID_LOGIN: "اسم المستخدم أو كلمة المرور غير صحيحة.",
      NOT_FOUND: "السجل المطلوب غير موجود.",
    };
    const message = errorMap[body.error] || body.detail || body.error || "حدث خطأ في الطلب";
    throw new Error(message);
  }
  return body;
}

async function loadState() {
  state = await api("/api/state");
  render();
  loadCompanyLogo().catch(() => {});
}

async function loadAudit() {
  const rows = await api("/api/audit");
  $("auditLog").innerHTML = rows.slice(0, 50).map((row) => `
    <div><strong>${esc(row.action)}</strong><br><span>${esc(row.user)} - ${new Date(row.at).toLocaleString("ar-IQ")}</span><br><small>${esc(row.detail)}</small></div>
  `).join("") || "<p>لا توجد حركة بعد</p>";
}

async function loadDashboard() {
  dashboard = await api("/api/dashboard");
  renderDashboard();
  renderHomeDashboard();
}

async function loadUsersPermissions() {
  usersPermissions = await api("/api/users-permissions");
  renderUsersPermissions();
}

async function loadCompanyLogo() {
  try {
    const result = await api("/api/company-logo");
    companyLogoData = result.data || null;
  } catch {
    companyLogoData = null;
  }
  renderCompanyLogoPreview();
}

function renderCompanyLogoPreview() {
  const preview = $("companyLogoPreview");
  if (!preview) return;
  if (companyLogoData) {
    preview.innerHTML = `<img src="${esc(companyLogoData)}" alt="شعار الشركة" style="max-height:80px;max-width:200px;" />`;
  } else {
    preview.innerHTML = "<span>لم يُرفع شعار بعد</span>";
  }
  const logo = $("journalPrintLogo");
  if (logo) {
    logo.src = companyLogoData || "";
    logo.style.display = companyLogoData ? "block" : "none";
  }
}

async function loadJournalPreview(journalId) {
  if (!journalId) return;
  const entry = await api(`/api/journal/${journalId}`);
  const modal = $("journalPreviewModal");
  const isBalanced = Math.abs(entry.totals.debit - entry.totals.credit) < 0.01;

  $("journalPrintMeta").innerHTML = `
    <div><strong>رقم القيد:</strong> ${esc(String(entry.id))}</div>
    <div><strong>التاريخ:</strong> ${esc(entry.entryDate || "")}</div>
    <div><strong>المصدر:</strong> ${esc(entry.source || "")}</div>
    <div><strong>البيان:</strong> ${esc(entry.memo || "")}</div>
    <div><strong>العملة:</strong> ${esc(entry.currency || "IQD")} - سعر الصرف: ${Number(entry.exchangeRate || 1).toFixed(4)}</div>
    <div><strong>الحالة:</strong> ${esc(entry.status || "")}</div>
  `;

  $("journalPrintLines").innerHTML = (entry.lines || []).map((line) => `
    <tr>
      <td>${esc(line.accountCode)}</td>
      <td>${esc(line.accountName || line.accountCode)}</td>
      <td>${esc(line.note)}</td>
      <td class="amount-cell">${line.debit > 0 ? money(line.debit) : ""}</td>
      <td class="amount-cell">${line.credit > 0 ? money(line.credit) : ""}</td>
    </tr>
  `).join("") || "<tr><td colspan='5'>لا توجد سطور</td></tr>";

  $("journalPrintDebit").textContent = money(entry.totals.debit);
  $("journalPrintCredit").textContent = money(entry.totals.credit);

  const balanceStatus = $("journalBalanceStatus");
  if (isBalanced) {
    balanceStatus.textContent = "✓ القيد متوازن";
    balanceStatus.className = "journal-balance-status balanced";
  } else {
    balanceStatus.textContent = `⚠ القيد غير متوازن - الفرق: ${money(Math.abs(entry.totals.debit - entry.totals.credit))}`;
    balanceStatus.className = "journal-balance-status unbalanced";
  }

  renderCompanyLogoPreview();
  modal.showModal();
}

function showModule(targetId = "homePanel") {
  moduleIds.forEach((id) => {
    const element = $(id);
    if (element) element.classList.toggle("module-hidden", id !== targetId);
  });
  document.querySelectorAll("[data-module-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.moduleTarget === targetId);
  });
  const target = $(targetId);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAccountOptions() {
  const options = (state.accounts || []).map((account) => (
    `<option value="${account.code} - ${account.name}"></option>`
  )).join("");
  if ($("accountDatalist")) $("accountDatalist").innerHTML = options;
  renderLedgerAccountResults("");
}

function lookupCode(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([0-9A-Za-z.-]+)\s*-/);
  return match ? match[1] : text;
}

function lookupId(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+)\s*-/);
  return match ? match[1] : text;
}

function accountLookupValue(code) {
  const account = (state?.accounts || []).find((row) => String(row.code) === String(code));
  return account ? `${account.code} - ${account.name}` : code;
}

function normalizeLookupFields(record) {
  ["cashAccountCode", "accountCode"].forEach((key) => {
    if (record[key] !== undefined) record[key] = lookupCode(record[key]);
  });
  if (record.invoiceId !== undefined) record.invoiceId = lookupId(record.invoiceId);
  return record;
}

function renderLedgerAccountResults(query) {
  if (!$("ledgerAccountResults") || !state?.accounts) return;
  const value = String(query || "").trim().toLowerCase();
  const matches = (state.accounts || []).filter((account) => {
    const haystack = `${account.code} ${account.name} ${account.type || ""}`.toLowerCase();
    return !value || haystack.includes(value);
  }).slice(0, 12);
  $("ledgerAccountResults").innerHTML = matches.map((account) => `
    <button type="button" class="account-result" data-code="${account.code}" data-name="${account.name}">
      <strong>${account.code}</strong>
      <span>${account.name}</span>
      <small>${account.type || ""} - ${account.level || ""}</small>
    </button>
  `).join("") || "<div class=\"account-no-results\">لا توجد حسابات مطابقة</div>";
  $("ledgerAccountResults").classList.toggle("open", Boolean(value));
}

function selectLedgerAccount(code, name) {
  selectedLedgerAccountCode = code || "";
  $("ledgerAccountCode").value = selectedLedgerAccountCode;
  $("ledgerAccountSearch").value = code ? `${code} - ${name || ""}` : "";
  $("ledgerAccountResults").classList.remove("open");
}

function renderOpeningLines() {
  const debitTotal = openingLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const creditTotal = openingLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const diff = debitTotal - creditTotal;
  const isBalanced = openingLines.length > 0 && Math.abs(diff) < 0.001;
  const summary = $("openingJournalSummary");
  summary.textContent = `المدين: ${money(debitTotal)} | الدائن: ${money(creditTotal)} | الفرق: ${money(diff)}`;
  summary.className = openingLines.length === 0 ? "" : isBalanced ? "balance-ok" : "balance-error";
  const submitBtn = $("openingJournalForm")?.querySelector("button[type=submit]");
  if (submitBtn) submitBtn.disabled = openingLines.length > 0 && !isBalanced;
  $("openingLinesTable").innerHTML = openingLines.map((line, index) => `
    <tr>
      <td><strong>${esc(line.accountCode)}</strong><br>مدين: ${money(line.debit)} | دائن: ${money(line.credit)}<br>${esc(line.note)}</td>
      <td><button type="button" class="secondary remove-opening-line" data-index="${index}">حذف</button></td>
    </tr>
  `).join("") || emptyRow;
}

function renderSaleLines() {
  const total = saleLines.reduce((sum, line) => sum + Number(line.total || 0), 0);
  $("saleLinesTable").innerHTML = saleLines.map((line, index) => `
    <tr>
      <td><strong>${esc(line.sku)} - ${esc(line.name)}</strong><br>${money(line.qty)} × ${money(line.unitPrice)} = ${money(line.total)}</td>
      <td><button type="button" class="secondary remove-sale-line" data-index="${index}">حذف</button></td>
    </tr>
  `).join("") || `<tr><td>لا توجد مواد في الفاتورة</td></tr>`;
  $("saleLinesTable").insertAdjacentHTML("beforeend", saleLines.length ? `<tr><td colspan="2"><strong>الإجمالي: ${money(total)}</strong></td></tr>` : "");
}

function renderSalesWorkflow() {
  const openInvoices = (state.sales || []).filter((row) => {
    const stage = String(row.workflowStage || row.status || "");
    return stage !== "Invoice Closed";
  });
  if ($("openInvoiceDatalist")) {
    $("openInvoiceDatalist").innerHTML = openInvoices.map((row) => `
      <option value="${esc(row.id)} - ${esc(row.invoiceNo || row.id)} - ${esc(row.customerName)} - المتبقي ${money(row.balance)}"></option>
    `).join("");
  }

  $("supplyOrdersList").innerHTML = (state.supplyOrders || []).map((row) => `
    <div class="workflow-item">
      <strong>${esc(row.invoiceNo || row.id)} - ${esc(row.customerName)}</strong>
      <span>${esc(row.workflowStage || row.status)}</span>
      <small>${(row.lines || []).map((line) => `${esc(line.sku)}: ${money(line.qty)}`).join(" | ")}</small>
      <button type="button" class="secondary process-supply-order" data-id="${row.id}">تنفيذ أمر التجهيز</button>
    </div>
  `).join("") || "<p>لا توجد أوامر تجهيز حاليا</p>";
}

function renderAccountsTree() {
  if (!$("accountsTreeTable")) return;
  const query = String($("accountsSearch")?.value || "").trim().toLowerCase();
  const rows = (state.accounts || []).filter((account) => {
    const haystack = `${account.code} ${account.name} ${account.type || ""} ${account.level || ""}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  $("accountsTreeTable").innerHTML = rows.map((account) => `
    <tr class="account-tree-row" data-code="${account.code}" data-name="${account.name}" data-type="${account.type || ""}" data-level="${account.level || ""}">
      <td><strong>${account.code}</strong></td>
      <td>${account.name}</td>
      <td>${account.type || ""}</td>
      <td>${account.level || ""}</td>
      <td>${money(account.balance)}</td>
    </tr>
  `).join("") || "<tr><td colspan=\"5\">لا توجد حسابات مطابقة</td></tr>";
}

function closeAccountContextMenu() {
  $("accountContextMenu")?.classList.add("hidden");
}

function openAccountModal({ mode, account }) {
  const modal = $("accountModal");
  $("accountModalMode").value = mode;
  if (mode === "add") {
    $("accountModalTitle").textContent = "إضافة حساب جديد";
    $("accountModalCode").value = account?.code || "";
    $("accountModalName").value = "";
    $("accountModalType").value = account?.type || "موجودات";
    $("accountModalLevel").value = "تحليلي";
    $("accountModalParent").value = account?.code || "";
    $("accountModalName").disabled = false;
    $("accountModalType").disabled = false;
    $("accountModalLevel").disabled = false;
    $("accountModalParent").disabled = false;
    $("accountModalSubmit").textContent = "حفظ";
  } else {
    $("accountModalTitle").textContent = "حذف حساب";
    $("accountModalCode").value = account?.code || "";
    $("accountModalName").value = account?.name || "";
    $("accountModalType").value = account?.type || "";
    $("accountModalLevel").value = account?.level || "";
    $("accountModalParent").value = "";
    $("accountModalName").disabled = true;
    $("accountModalType").disabled = true;
    $("accountModalLevel").disabled = true;
    $("accountModalParent").disabled = true;
    $("accountModalSubmit").textContent = "تأكيد الحذف";
  }
  modal.showModal();
}

function renderInventoryTrace() {
  if (!$("inventoryTraceTable")) return;
  if (!inventoryTraceReport || !(inventoryTraceReport.items || []).length) {
    $("inventoryTraceTable").innerHTML = "<tr><td colspan=\"6\">لا توجد حركات للمادة المحددة</td></tr>";
    return;
  }
  const rows = [];
  for (const item of inventoryTraceReport.items) {
    if (!(item.moves || []).length) {
      rows.push(`
        <tr>
          <td><strong>${item.sku}</strong><br>${item.name}</td>
          <td>-</td><td>-</td><td>0</td><td>${money(item.currentQty)}</td><td>-</td>
        </tr>
      `);
      continue;
    }
    for (const move of item.moves) {
      rows.push(`
        <tr>
          <td><strong>${item.sku}</strong><br>${item.name}</td>
          <td>${move.date || ""}</td>
          <td>${move.direction === "IN" ? "دخول" : "خروج"}</td>
          <td>${money(move.qty)}</td>
          <td><strong>${money(move.runningQty)}</strong></td>
          <td>${move.source || ""} ${move.sourceId ? `#${move.sourceId}` : ""}</td>
        </tr>
      `);
    }
    rows.push(`
      <tr>
        <td colspan="6"><strong>الرصيد الحالي:</strong> ${money(item.currentQty)} | <strong>إجمالي دخول:</strong> ${money(item.totals.inQty)} | <strong>إجمالي خروج:</strong> ${money(item.totals.outQty)}</td>
      </tr>
    `);
  }
  $("inventoryTraceTable").innerHTML = rows.join("");
}

function metricRows(rows) {
  return rows.map((row) => `
    <div>
      <span>${row.label}</span>
      <strong>${typeof row.value === "number" ? money(row.value) : row.value}${row.suffix || ""}</strong>
    </div>
  `).join("");
}

function renderBars(rows, targetId) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value || row.qty || 0)));
  $(targetId).innerHTML = rows.map((row) => {
    const value = Number(row.value || row.qty || 0);
    return `
      <div class="bar-row">
        <span>${esc(row.label || row.name || row.sku || "غير محدد")}</span>
        <div><i style="width:${Math.max(4, (value / max) * 100)}%"></i></div>
        <b>${money(value)}</b>
      </div>
    `;
  }).join("") || "<p>لا توجد بيانات كافية بعد</p>";
}

function renderLineChart(rows, targetId) {
  const values = (rows || []).map((row) => Number(row.value || 0));
  const max = Math.max(1, ...values);
  $(targetId).innerHTML = (rows || []).map((row) => {
    const height = Math.max(8, (Number(row.value || 0) / max) * 112);
    return `
      <div class="line-point">
        <i style="height:${height}px"></i>
        <b>${money(row.value)}</b>
        <span>${String(row.month || "").slice(5)}</span>
      </div>
    `;
  }).join("") || "<p>لا توجد حركة شهرية بعد</p>";
}

function renderDashboard() {
  if (!dashboard) return;
  const financial = dashboard.financial || {};
  const sales = dashboard.sales || {};
  const maintenance = dashboard.maintenance || {};
  const inventory = dashboard.inventory || {};

  $("kpiNetProfit").textContent = money(financial.netProfit);
  $("kpiReceivables").textContent = money(financial.receivables);
  $("kpiCashBanks").textContent = money(financial.cashAndBanks);
  $("kpiInventoryValue").textContent = money(inventory.currentValue);

  $("financialMetrics").innerHTML = metricRows([
    { label: "الإيرادات الشهرية", value: financial.monthlyRevenue },
    { label: "المصروفات الشهرية", value: financial.monthlyExpenses },
    { label: "التدفق النقدي", value: financial.cashFlow },
    { label: "الذمم الدائنة", value: financial.payables }
  ]);

  $("salesMetrics").innerHTML = metricRows([
    { label: "نسبة التحصيل", value: Number(sales.collectionRate || 0).toFixed(1), suffix: "%" },
    { label: "أفضل موظف مبيعات", value: sales.bestSalesEmployee || "غير محدد", suffix: "" }
  ]);

  $("maintenanceMetrics").innerHTML = metricRows([
    { label: "الصيانات المفتوحة", value: maintenance.openJobs },
    { label: "العقود المتأخرة", value: (maintenance.overdueContracts || []).length }
  ]);

  $("inventoryMetrics").innerHTML = metricRows([
    { label: "قطع قاربت النفاد", value: (inventory.lowStock || []).length },
    { label: "أصناف راكدة", value: (inventory.deadStock || []).length },
    { label: "قطع/مولدات بضمان", value: (inventory.warrantyItems || []).length }
  ]);

  const trend = dashboard.trends?.monthlyFinancial || [];
  const maxProfit = Math.max(1, ...trend.map((row) => Math.abs(Number(row.profit || 0))));
  $("profitTrend").innerHTML = trend.map((row) => `
    <div class="trend-col">
      <i style="height:${Math.max(6, (Math.abs(Number(row.profit || 0)) / maxProfit) * 120)}px" class="${Number(row.profit || 0) < 0 ? "negative" : ""}"></i>
      <span>${row.month.slice(5)}</span>
    </div>
  `).join("") || "<p>لا توجد حركة شهرية بعد</p>";

  renderBars((sales.topCustomers || []).slice(0, 5), "topCustomersChart");
  renderLineChart((sales.salesByMonth || []).slice(-6), "monthlySalesChart");
  $("maintenanceWarnings").innerHTML = (maintenance.overdueContracts || []).slice(0, 5).map((row) => `
    <div><strong>${esc(row.invoiceNo || row.id || "طلب")}</strong><span>${esc(row.status)}</span></div>
  `).join("") || "<p>لا توجد تنبيهات صيانة حالياً</p>";
  $("lowStockList").innerHTML = (inventory.lowStock || []).slice(0, 6).map((item) => `
    <div><strong>${esc(item.sku)} - ${esc(item.name)}</strong><span>المتوفر: ${money(item.qty)}</span></div>
  `).join("") || "<p>لا توجد أصناف منخفضة حالياً</p>";
  renderBars((inventory.topMovingParts || []).map((row) => ({
    label: `${row.sku || ""} ${row.name || ""}`.trim(),
    value: row.qty || 0
  })).slice(0, 5), "topMovingPartsChart");
}

function renderHomeDashboard() {
  if (!dashboard || !$("homeNetProfit")) return;
  const financial = dashboard.financial || {};
  const sales = dashboard.sales || {};
  const maintenance = dashboard.maintenance || {};
  const inventory = dashboard.inventory || {};
  $("homeNetProfit").textContent = money(financial.netProfit);
  $("homeCollectionRate").textContent = `${Number(sales.collectionRate || 0).toFixed(1)}%`;
  $("homeInventoryValue").textContent = money(inventory.currentValue);
  $("homeOpenMaintenance").textContent = money(maintenance.openJobs);
  renderLineChart((sales.salesByMonth || []).slice(-6), "homeSalesChart");
  renderBars((sales.topCustomers || []).slice(0, 5), "homeTopCustomers");

  const trend = dashboard.trends?.monthlyFinancial || [];
  const maxValue = Math.max(1, ...trend.flatMap((row) => [Math.abs(Number(row.profit || 0)), Math.abs(Number(row.expenses || 0))]));
  $("homeProfitChart").innerHTML = trend.map((row) => `
    <div class="trend-col">
      <i style="height:${Math.max(6, (Math.abs(Number(row.profit || 0)) / maxValue) * 120)}px" class="${Number(row.profit || 0) < 0 ? "negative" : ""}"></i>
      <span>${row.month.slice(5)}</span>
    </div>
  `).join("") || "<p>لا توجد حركة شهرية بعد</p>";

  $("homeLowStock").innerHTML = (inventory.lowStock || []).slice(0, 5).map((item) => `
    <div><strong>${esc(item.sku)} - ${esc(item.name)}</strong><span>المتوفر: ${money(item.qty)}</span></div>
  `).join("") || "<p>لا توجد تنبيهات مخزون حالياً</p>";
}

function permissionsForRole(role) {
  const rows = usersPermissions?.permissions || [];
  return new Set(rows.filter((row) => row.role === role && row.allowed).map((row) => row.permission));
}

function renderUsersPermissions() {
  if (!usersPermissions) return;
  const roles = usersPermissions.roles || [];
  const previousUserRole = $("userRole").value;
  const previousPermissionRole = $("permissionRole").value;
  const roleOptions = roles.map((role) => `<option>${role}</option>`).join("");
  $("userRole").innerHTML = roleOptions;
  $("permissionRole").innerHTML = roleOptions;
  if (roles.includes(previousUserRole)) $("userRole").value = previousUserRole;
  if (roles.includes(previousPermissionRole)) $("permissionRole").value = previousPermissionRole;
  const selectedRole = $("permissionRole").value || roles[0] || "";
  const allowed = permissionsForRole(selectedRole);
  $("permissionList").innerHTML = (usersPermissions.catalog || []).map((permission) => `
    <label class="check-row">
      <input type="checkbox" value="${permission.key}" ${allowed.has(permission.key) ? "checked" : ""} />
      ${permission.label}
    </label>
  `).join("") || "<p>لا توجد صلاحيات معرفة</p>";
  $("usersTable").innerHTML = (usersPermissions.users || []).map((user) => `
    <tr>
      <td><strong>${esc(user.name)}</strong><br>${esc(user.username)}</td>
      <td>${esc(user.role)}</td>
      <td>${user.active ? "مفعل" : "موقوف"}</td>
      <td><button type="button" class="secondary edit-user" data-id="${user.id}">تعديل</button></td>
    </tr>
  `).join("") || emptyRow;
}

function renderCurrencySettings() {
  if (!$("baseCurrency") || !state) return;
  const settings = state.settings || { baseCurrency: "IQD", secondaryCurrency: "USD" };
  $("baseCurrency").value = settings.baseCurrency || "IQD";
  $("secondaryCurrency").value = settings.secondaryCurrency || "USD";
  $("exchangeBaseCurrency").value = settings.baseCurrency || "IQD";
  $("exchangeQuoteCurrency").value = settings.secondaryCurrency || "USD";
  if (!$("exchangeRateDate").value) $("exchangeRateDate").value = new Date().toISOString().slice(0, 10);
  $("exchangeRatesTable").innerHTML = (state.exchangeRates || []).map((row) => `
    <tr>
      <td>${row.rateDate || ""}</td>
      <td>${row.baseCurrency || ""}</td>
      <td>${row.quoteCurrency || ""}</td>
      <td>${Number(row.rate || 0).toFixed(6)}</td>
      <td>${row.source || ""}</td>
      <td>${row.note || ""}</td>
    </tr>
  `).join("") || "<tr><td colspan=\"6\">لا توجد أسعار صرف مسجلة</td></tr>";
}

function rateToBase(currency) {
  const settings = state?.settings || { baseCurrency: "IQD" };
  const base = String(settings.baseCurrency || "IQD").toUpperCase();
  const target = String(currency || base).toUpperCase();
  if (target === base) return 1;
  const rows = state?.exchangeRates || [];
  const direct = rows.find((row) => String(row.baseCurrency).toUpperCase() === target && String(row.quoteCurrency).toUpperCase() === base);
  if (direct && Number(direct.rate) > 0) return Number(direct.rate);
  const reverse = rows.find((row) => String(row.baseCurrency).toUpperCase() === base && String(row.quoteCurrency).toUpperCase() === target);
  if (reverse && Number(reverse.rate) > 0) return 1 / Number(reverse.rate);
  return 1;
}

function syncCurrencyFields(scope = document) {
  const settings = state?.settings || { baseCurrency: "IQD", secondaryCurrency: "USD" };
  const base = String(settings.baseCurrency || "IQD").toUpperCase();
  const secondary = String(settings.secondaryCurrency || "USD").toUpperCase();
  scope.querySelectorAll(".currency-select").forEach((select) => {
    if (!select.dataset.bound) {
      select.innerHTML = `<option>${base}</option><option>${secondary}</option>`;
      select.dataset.bound = "1";
      if (!select.value) select.value = base;
      select.addEventListener("change", () => {
        const form = select.closest("form");
        const rateInput = form?.querySelector(".exchange-rate-input");
        if (!rateInput) return;
        const rate = rateToBase(select.value);
        rateInput.value = Number(rate).toFixed(6);
        rateInput.readOnly = String(select.value).toUpperCase() === base;
      });
    } else {
      const previous = select.value;
      select.innerHTML = `<option>${base}</option><option>${secondary}</option>`;
      select.value = previous === secondary ? secondary : base;
    }
    const form = select.closest("form");
    const rateInput = form?.querySelector(".exchange-rate-input");
    if (rateInput) {
      const rate = rateToBase(select.value);
      if (!rateInput.value || Number(rateInput.value) <= 0 || rateInput.readOnly) rateInput.value = Number(rate).toFixed(6);
      rateInput.readOnly = String(select.value).toUpperCase() === base;
    }
  });
}

function clearUserForm() {
  $("userId").value = "";
  $("userName").value = "";
  $("userUsername").value = "";
  $("userPassword").value = "";
  $("userActive").checked = true;
}

function render() {
  renderAccountOptions();
  renderOpeningLines();
  renderSaleLines();
  renderSalesWorkflow();
  renderAccountsTree();
  renderInventoryTrace();
  renderCurrencySettings();
  syncCurrencyFields(document);

  $("customersTable").innerHTML = state.customers.map((row) => `
    <tr><td><strong>${esc(row.name)}</strong><br>${esc(row.phone)}<br>${esc(row.address)}<br>${esc(row.sector || "غير مصنف")}${row.customerKind ? " / " + esc(row.customerKind) : ""}</td></tr>
  `).join("") || emptyRow;

  $("suppliersTable").innerHTML = state.suppliers.map((row) => `
    <tr><td><strong>${esc(row.name)}</strong><br>${esc(row.phone)}<br>${esc(row.type)}</td></tr>
  `).join("") || emptyRow;

  $("itemsTable").innerHTML = state.items.map((row) => `
    <tr><td><strong>${esc(row.sku)} - ${esc(row.name)}</strong><br>${esc(row.category)} / ${esc(row.brand)}<br>كمية: ${money(row.qty)} - كلفة: ${money(row.cost)}</td></tr>
  `).join("") || emptyRow;

  $("salesTable").innerHTML = (state.sales || []).map((row) => `
    <tr><td><strong>${esc(row.invoiceNo || row.id)} - ${esc(row.customerName)}</strong><br>${esc(row.status)}<br>الإجمالي: ${money(row.total)} | المقبوض: ${money(row.paidAmount)} | المتبقي: ${money(row.balance)}</td></tr>
  `).join("") || emptyRow;

  $("supplyOrdersTable").innerHTML = (state.supplyOrders || []).map((row) => `
    <tr><td><strong>${esc(row.invoiceNo || row.id)} - ${esc(row.customerName)}</strong><br>${esc(row.status)}<br>${(row.lines || []).map((line) => `${esc(line.sku)}: ${money(line.qty)}`).join(" | ")}</td></tr>
  `).join("") || emptyRow;

  $("purchaseRequestsTable").innerHTML = (state.purchaseRequests || []).map((row) => `
    <tr><td><strong>طلب شراء للفاتورة ${esc(row.invoiceNo)}</strong><br>${esc(row.status)}<br>${(row.lines || []).map((line) => `${esc(line.sku)}: ناقص ${money(line.missingQty)}`).join(" | ")}</td></tr>
  `).join("") || emptyRow;

  $("receiptsTable").innerHTML = (state.receipts || []).map((row) => `
    <tr><td><strong>${esc(row.customerName || "-")}</strong><br>${esc(row.receiptType)} - ${esc(row.paymentMethod)}<br>${money(row.amount)} | قيد ${esc(row.journalId)}</td></tr>
  `).join("") || emptyRow;

  $("openingJournalsTable").innerHTML = (state.openingJournals || []).map((row) => `
    <tr><td><strong>${esc(row.memo || "قيد افتتاحي")}</strong><br>${esc(row.date)}<br>قيد ${esc(row.journalId)}</td></tr>
  `).join("") || emptyRow;

  $("openingInventoryTable").innerHTML = (state.openingInventory || []).map((row) => `
    <tr><td><strong>${esc(row.sku)} - ${esc(row.name)}</strong><br>${esc(row.brand)} / ${esc(row.category)}<br>${money(row.qty)} × ${money(row.cost)} = ${money(row.amount)}</td></tr>
  `).join("") || emptyRow;

  $("payrollsTable").innerHTML = (state.payrolls || []).map((row) => `
    <tr><td><strong>${esc(row.employeeName || "-")}</strong><br>${esc(row.kind)} - ${money(row.amount)}<br>${esc(row.memo)}</td></tr>
  `).join("") || emptyRow;

  $("maintenanceRevenuesTable").innerHTML = (state.maintenanceRevenues || []).map((row) => `
    <tr><td><strong>${esc(row.customerName || "-")}</strong><br>${esc(row.paymentStatus)} - ${money(row.amount)}<br>${esc(row.memo)}</td></tr>
  `).join("") || emptyRow;

  $("fixedAssetsTable").innerHTML = (state.fixedAssets || []).map((row) => `
    <tr><td><strong>${esc(row.assetType)} - ${esc(row.assetName || "-")}</strong><br>${money(row.amount)}<br>حساب ${esc(row.accountCode)}</td></tr>
  `).join("") || emptyRow;

  const templates = state.invoiceTemplates || [];
  const activeTemplate = templates.find((t) => t.active);
  const badge = $("activeTemplateBadge");
  if (badge) {
    if (activeTemplate) {
      badge.textContent = `القالب النشط: ${activeTemplate.name}`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
  const tbl2 = $("invoiceTemplatesTable2");
  if (tbl2) {
    tbl2.innerHTML = templates.map((row) => `
      <tr>
        <td><strong>${esc(row.name)}</strong></td>
        <td>${esc(row.originalFilename)}</td>
        <td>${new Date(row.createdAt).toLocaleString("ar-IQ")}</td>
        <td>${row.active ? "<span class=\"badge-active\">نشط</span>" : ""}</td>
        <td>
          <button type="button" class="secondary tiny activate-template-btn" data-id="${row.id}">${row.active ? "نشط" : "تفعيل"}</button>
          <a class="secondary tiny btn-link" href="/api/invoice-templates/${row.id}/download">تنزيل</a>
        </td>
      </tr>
    `).join("") || "<tr><td colspan='5'>لا توجد قوالب</td></tr>";
  }
  const tbl1 = $("invoiceTemplatesTable");
  if (tbl1) {
    tbl1.innerHTML = templates.map((row) => `
      <tr><td><strong>${esc(row.name)}</strong><br>${esc(row.originalFilename)}<br>${new Date(row.createdAt).toLocaleString("ar-IQ")}<br><a href="/api/invoice-templates/${row.id}/download">تنزيل القالب</a></td></tr>
    `).join("") || "<tr><td>لا توجد قوالب</td></tr>";
  }
}

function renderLedger(ledger) {
  currentLedger = ledger;
  $("ledgerSummary").textContent = `${ledger.account.code} - ${ledger.account.name} | مجموع المدين: ${money(ledger.totals.debit)} | مجموع الدائن: ${money(ledger.totals.credit)} | الرصيد: ${money(ledger.totals.balance)}`;
  $("ledgerTable").innerHTML = (ledger.rows || []).map((row) => `
    <tr>
      <td>${esc(row.date)}</td>
      <td>${row.journalId ? `<button type="button" class="link-btn view-journal-btn" data-id="${row.journalId}">${esc(String(row.journalId))}</button>` : ""}<br><small>${esc(row.source)}</small></td>
      <td>${esc(row.memo)}</td>
      <td>${row.debit > 0 ? money(row.debit) : ""}</td>
      <td>${row.credit > 0 ? money(row.credit) : ""}</td>
      <td><strong>${money(row.balance)}</strong></td>
    </tr>
  `).join("") || "<tr><td colspan=\"6\">لا توجد حركة على هذا الحساب</td></tr>";
}

function formObject(form) {
  return normalizeLookupFields(Object.fromEntries(new FormData(form)));
}

async function upsert(collection, record) {
  await api("/api/upsert", { method: "POST", body: JSON.stringify({ collection, record }) });
  await loadState();
  await loadAudit();
}

async function postFinance(type, record) {
  await api("/api/post-finance", { method: "POST", body: JSON.stringify({ type, ...record }) });
  await loadState();
  await loadAudit();
}

async function postRecord(path, record) {
  await api(path, { method: "POST", body: JSON.stringify(record) });
  await loadState();
  await loadAudit();
}

async function loadInventoryTrace() {
  const params = new URLSearchParams();
  if ($("inventoryTraceQuery")?.value.trim()) params.set("query", $("inventoryTraceQuery").value.trim());
  if ($("inventoryTraceFrom")?.value) params.set("dateFrom", $("inventoryTraceFrom").value);
  if ($("inventoryTraceTo")?.value) params.set("dateTo", $("inventoryTraceTo").value);
  inventoryTraceReport = await api(`/api/inventory-trace?${params.toString()}`);
  const totalItems = (inventoryTraceReport.items || []).length;
  const totalMoves = (inventoryTraceReport.items || []).reduce((sum, item) => sum + (item.moves || []).length, 0);
  $("inventoryTraceSummary").textContent = `عدد المواد: ${money(totalItems)} | عدد الحركات: ${money(totalMoves)}`;
  renderInventoryTrace();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(formObject(event.currentTarget)) });
    $("loginPanel").classList.add("hidden");
    $("appPanel").classList.remove("hidden");
    await loadState();
    await loadAudit();
    await loadDashboard();
    showModule("homePanel");
  } catch (error) {
    alert(error.message);
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

$("customerSector").addEventListener("change", (event) => {
  const isPrivate = event.currentTarget.value === "قطاع خاص";
  $("customerKindLabel").classList.toggle("hidden", !isPrivate);
  $("customerKind").disabled = !isPrivate;
});

$("customerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  if (record.sector === "قطاع عام") record.customerKind = "جهة حكومية";
  record.type = `${record.sector} - ${record.customerKind}`;
  await upsert("customers", record);
  event.currentTarget.reset();
  $("customerKindLabel").classList.remove("hidden");
  $("customerKind").disabled = false;
});

$("supplierForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await upsert("suppliers", formObject(event.currentTarget));
  event.currentTarget.reset();
});

$("itemForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.qty = Number(record.qty || 0);
  record.cost = Number(record.cost || 0);
  record.salePrice = Number(record.salePrice || 0);
  await upsert("items", record);
  event.currentTarget.reset();
});

$("dedupeCustomersBtn")?.addEventListener("click", async () => {
  const ok = confirm("سيتم دمج الزبائن المكررين حسب الاسم/الهاتف. متابعة؟");
  if (!ok) return;
  const result = await api("/api/dedupe/customers", { method: "POST", body: JSON.stringify({}) });
  notify(`تم دمج ${money(result.mergedGroups)} مجموعة زبائن وحذف ${money(result.removedCount)} سجل مكرر`, "ok");
  await loadState();
  await loadAudit();
});

$("dedupeItemsBtn")?.addEventListener("click", async () => {
  const ok = confirm("سيتم دمج المواد/المولدات المكررة وجمع الكميات. متابعة؟");
  if (!ok) return;
  const result = await api("/api/dedupe/items", { method: "POST", body: JSON.stringify({}) });
  notify(`تم دمج ${money(result.mergedGroups)} مجموعة مواد وحذف ${money(result.removedCount)} سجل مكرر`, "ok");
  await loadState();
  await loadAudit();
});

$("addSaleLineBtn").addEventListener("click", () => {
  const sku = $("saleLineSku").value.trim();
  const name = $("saleLineName").value.trim();
  const qty = Number($("saleLineQty").value || 0);
  const unitPrice = Number($("saleLinePrice").value || 0);
  if (!sku || qty <= 0) return alert("أدخل رمز المادة والكمية");
  saleLines.push({ sku, name, qty, unitPrice, total: qty * unitPrice });
  $("saleLineSku").value = "";
  $("saleLineName").value = "";
  $("saleLineQty").value = "";
  $("saleLinePrice").value = "";
  renderSaleLines();
});

$("saleLinesTable").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-sale-line");
  if (!button) return;
  saleLines.splice(Number(button.dataset.index), 1);
  renderSaleLines();
});

$("salesInvoiceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!saleLines.length) return alert("أضف مادة واحدة على الأقل");
  const record = formObject(event.currentTarget);
  await postRecord("/api/sales-invoice", { ...record, lines: saleLines });
  saleLines = [];
  event.currentTarget.reset();
  renderSaleLines();
});

$("invoicePaymentMethod").addEventListener("change", (event) => {
  $("invoiceCashAccount").value = accountLookupValue(event.currentTarget.value === "دفع إلكتروني" ? "1621" : "1611");
});

$("invoicePaymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  if (!record.invoiceId) return alert("اختر الفاتورة");
  record.amount = Number(record.amount || 0);
  await postRecord("/api/invoice-payment", record);
  event.currentTarget.reset();
  $("invoiceCashAccount").value = accountLookupValue("1611");
});

$("supplyOrdersList").addEventListener("click", async (event) => {
  const button = event.target.closest(".process-supply-order");
  if (!button) return;
  await postRecord("/api/process-supply-order", { orderId: Number(button.dataset.id) });
});

$("receiptPaymentMethod").addEventListener("change", (event) => {
  $("receiptCashAccount").value = accountLookupValue(event.currentTarget.value === "دفع إلكتروني" ? "1621" : "1611");
});

$("receiptForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.amount = Number(record.amount || 0);
  await postRecord("/api/receipts", record);
  event.currentTarget.reset();
  $("receiptCashAccount").value = accountLookupValue("1611");
});

$("addOpeningLineBtn").addEventListener("click", () => {
  const amount = Number($("openingAmount").value || 0);
  if (amount <= 0) return alert("أدخل مبلغ السطر");
  const side = $("openingSide").value;
  const accountCode = lookupCode($("openingAccountSelect").value);
  if (!accountCode) return alert("اختر الحساب");
  openingLines.push({
    accountCode,
    debit: side === "debit" ? amount : 0,
    credit: side === "credit" ? amount : 0,
    note: $("openingNote").value
  });
  $("openingAmount").value = "";
  $("openingNote").value = "";
  renderOpeningLines();
});

$("openingLinesTable").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-opening-line");
  if (!button) return;
  openingLines.splice(Number(button.dataset.index), 1);
  renderOpeningLines();
});

$("openingJournalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const debitTotal = openingLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const creditTotal = openingLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  if (!openingLines.length || Math.abs(debitTotal - creditTotal) > 0.001) return alert("القيد غير متوازن ولا يمكن حفظه");
  const record = formObject(event.currentTarget);
  await postRecord("/api/opening-journal", { ...record, lines: openingLines });
  openingLines = [];
  event.currentTarget.reset();
  renderOpeningLines();
});

$("openingInventoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.qty = Number(record.qty || 0);
  record.cost = Number(record.cost || 0);
  record.salePrice = Number(record.salePrice || 0);
  await postRecord("/api/opening-inventory", record);
  event.currentTarget.reset();
});

$("payrollForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.amount = Number(record.amount || 0);
  await postFinance("payroll", record);
  event.currentTarget.reset();
});

$("maintenanceRevenueForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.amount = Number(record.amount || 0);
  await postFinance("maintenanceRevenue", record);
  event.currentTarget.reset();
});

$("fixedAssetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.amount = Number(record.amount || 0);
  await postFinance("fixedAsset", record);
  event.currentTarget.reset();
});

$("invoiceTemplateUploadForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formObject(form);
  const file = form.templateFile.files[0];
  if (!file) return alert("اختر ملف Word");
  if (!file.name.toLowerCase().endsWith(".docx")) return alert("يجب أن يكون الملف DOCX");
  await api("/api/invoice-templates", {
    method: "POST",
    body: JSON.stringify({
      name: data.name,
      filename: file.name,
      mimeType: file.type,
      contentBase64: await fileToBase64(file),
      fields: {
        customerName: "اسم الزبون",
        generatorCapacity: "سعة المولد",
        warrantyYears: "سنوات الضمان",
        warrantyHours: "ساعات الضمان"
      }
    })
  });
  notify("تم رفع القالب بنجاح", "ok");
  form.reset();
  await loadState();
  await loadAudit();
});

document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".activate-template-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  await api(`/api/invoice-templates/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
  notify("تم تفعيل القالب", "ok");
  await loadState();
});

$("saveCompanyLogoBtn")?.addEventListener("click", async () => {
  const file = $("companyLogoInput")?.files[0];
  if (!file) return alert("اختر صورة الشعار");
  const logoBase64 = await fileToBase64(file);
  await api("/api/company-logo", { method: "POST", body: JSON.stringify({ logoBase64 }) });
  companyLogoData = logoBase64;
  renderCompanyLogoPreview();
  notify("تم حفظ شعار الشركة", "ok");
});

$("removeCompanyLogoBtn")?.addEventListener("click", async () => {
  if (!confirm("هل تريد حذف شعار الشركة؟")) return;
  await api("/api/company-logo", { method: "POST", body: JSON.stringify({ logoBase64: "" }) });
  companyLogoData = null;
  renderCompanyLogoPreview();
  notify("تم حذف الشعار", "ok");
});

$("closeJournalPreviewBtn")?.addEventListener("click", () => {
  $("journalPreviewModal")?.close();
});

$("printJournalBtn")?.addEventListener("click", () => {
  window.print();
});

document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".view-journal-btn");
  if (!btn) return;
  const journalId = Number(btn.dataset.id);
  if (!journalId) return;
  try {
    await loadJournalPreview(journalId);
  } catch (error) {
    notify(error.message || "تعذر تحميل بيانات القيد", "error");
  }
});

$("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = formObject(event.currentTarget);
  record.active = $("userActive").checked;
  if (!record.id) delete record.id;
  if (!record.password) delete record.password;
  await api("/api/users", { method: "POST", body: JSON.stringify(record) });
  clearUserForm();
  await loadUsersPermissions();
  await loadAudit();
});

$("clearUserFormBtn").addEventListener("click", clearUserForm);
$("reloadUsersPermissionsBtn").addEventListener("click", loadUsersPermissions);

$("permissionRole").addEventListener("change", renderUsersPermissions);

$("savePermissionsBtn").addEventListener("click", async () => {
  const permissions = Array.from($("permissionList").querySelectorAll("input:checked")).map((input) => input.value);
  await api("/api/role-permissions", {
    method: "POST",
    body: JSON.stringify({ role: $("permissionRole").value, permissions })
  });
  await loadUsersPermissions();
  await loadAudit();
});

$("currencySettingsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    baseCurrency: $("baseCurrency").value,
    secondaryCurrency: $("secondaryCurrency").value
  };
  if (payload.baseCurrency === payload.secondaryCurrency) return alert("يجب أن تكون العملة الأساسية مختلفة عن الثانوية");
  await api("/api/settings/currency", { method: "POST", body: JSON.stringify(payload) });
  notify("تم حفظ إعدادات العملة", "ok");
  await loadState();
  await loadAudit();
});

$("exchangeRateForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    rateDate: $("exchangeRateDate").value,
    baseCurrency: $("exchangeBaseCurrency").value,
    quoteCurrency: $("exchangeQuoteCurrency").value,
    rate: Number($("exchangeRateValue").value || 0),
    note: $("exchangeRateNote").value || ""
  };
  if (payload.baseCurrency === payload.quoteCurrency) return alert("اختر عملتين مختلفتين");
  await api("/api/settings/exchange-rate", { method: "POST", body: JSON.stringify(payload) });
  notify("تم حفظ سعر الصرف", "ok");
  event.currentTarget.reset();
  $("exchangeRateDate").value = new Date().toISOString().slice(0, 10);
  await loadState();
  await loadAudit();
});

$("usersTable").addEventListener("click", (event) => {
  const button = event.target.closest(".edit-user");
  if (!button || !usersPermissions) return;
  const user = usersPermissions.users.find((row) => String(row.id) === String(button.dataset.id));
  if (!user) return;
  $("userId").value = user.id;
  $("userName").value = user.name;
  $("userUsername").value = user.username;
  $("userRole").value = user.role;
  $("userPassword").value = "";
  $("userActive").checked = Boolean(user.active);
});

$("accountsSearch")?.addEventListener("input", renderAccountsTree);

$("accountsTreeTable")?.addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".account-tree-row");
  if (!row) return;
  event.preventDefault();
  selectedAccountContext = {
    code: row.dataset.code,
    name: row.dataset.name,
    type: row.dataset.type,
    level: row.dataset.level,
    parentCode: row.dataset.parent,
    currency: row.dataset.currency,
    nature: row.dataset.nature,
    classification: row.dataset.classification
  };
  const menu = $("accountContextMenu");
  menu.style.top = `${event.clientY + window.scrollY}px`;
  menu.style.left = `${event.clientX}px`;
  menu.classList.remove("hidden");
});

$("accountsTreeTable")?.addEventListener("click", (event) => {
  const toggle = event.target.closest(".tree-toggle");
  if (!toggle) return;
  const code = String(toggle.dataset.toggle || "");
  if (!code) return;
  if (accountTreeExpanded.has(code)) accountTreeExpanded.delete(code);
  else accountTreeExpanded.add(code);
  renderAccountsTree();
});

$("accountsTreeTable")?.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".account-tree-row");
  if (!row) return;
  event.dataTransfer.setData("text/plain", row.dataset.code || "");
  row.classList.add("dragging");
});

$("accountsTreeTable")?.addEventListener("dragend", (event) => {
  const row = event.target.closest(".account-tree-row");
  row?.classList.remove("dragging");
  document.querySelectorAll(".account-tree-row.drop-target").forEach((el) => el.classList.remove("drop-target"));
});

$("accountsTreeTable")?.addEventListener("dragover", (event) => {
  const row = event.target.closest(".account-tree-row");
  if (!row) return;
  event.preventDefault();
  document.querySelectorAll(".account-tree-row.drop-target").forEach((el) => el.classList.remove("drop-target"));
  row.classList.add("drop-target");
});

$("accountsTreeTable")?.addEventListener("drop", async (event) => {
  const targetRow = event.target.closest(".account-tree-row");
  if (!targetRow) return;
  event.preventDefault();
  const code = event.dataTransfer.getData("text/plain");
  const newParentCode = targetRow.dataset.code || "";
  if (!code || !newParentCode || code === newParentCode) return;
  try {
    await api("/api/accounts/reparent", { method: "POST", body: JSON.stringify({ code, newParentCode }) });
    notify("تم نقل الحساب داخل الشجرة", "ok");
    await loadState();
  } catch (error) {
    notify(error.message || "تعذر نقل الحساب", "error");
  } finally {
    targetRow.classList.remove("drop-target");
  }
});

$("accountContextMenu")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !selectedAccountContext) return;
  const action = button.dataset.action;
  closeAccountContextMenu();
  if (action === "ledger") {
    selectLedgerAccount(selectedAccountContext.code, selectedAccountContext.name);
    showModule("ledgerPanel");
    return;
  }
  if (action === "add") return openAccountModal({ mode: "add", account: selectedAccountContext });
  if (action === "delete") return openAccountModal({ mode: "delete", account: selectedAccountContext });
});

$("loadInventoryTraceBtn")?.addEventListener("click", loadInventoryTrace);
$("accountModalCancel")?.addEventListener("click", () => $("accountModal")?.close());
$("accountModalForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = $("accountModalMode").value;
  try {
    if (mode === "add") {
      await api("/api/accounts/add", {
        method: "POST",
        body: JSON.stringify({
          code: $("accountModalCode").value.trim(),
          name: $("accountModalName").value.trim(),
          type: $("accountModalType").value.trim() || "موجودات",
          level: $("accountModalLevel").value.trim() || "تحليلي",
          parentCode: $("accountModalParent").value.trim()
        })
      });
      notify("تمت إضافة الحساب بنجاح", "ok");
    } else if (mode === "delete") {
      await api("/api/accounts/delete", {
        method: "POST",
        body: JSON.stringify({ code: $("accountModalCode").value.trim() })
      });
      notify("تم حذف الحساب بنجاح", "ok");
    }
    $("accountModal")?.close();
    await loadState();
    await loadAudit();
  } catch (error) {
    notify(error.message || "فشلت العملية", "error");
  }
});

function ledgerParams() {
  const params = new URLSearchParams();
  params.set("accountCode", selectedLedgerAccountCode || $("ledgerAccountCode").value || "");
  if ($("ledgerDateFrom").value) params.set("dateFrom", $("ledgerDateFrom").value);
  if ($("ledgerDateTo").value) params.set("dateTo", $("ledgerDateTo").value);
  if ($("ledgerSource").value) params.set("source", $("ledgerSource").value);
  if ($("ledgerSide").value) params.set("side", $("ledgerSide").value);
  if ($("ledgerSearch").value.trim()) params.set("search", $("ledgerSearch").value.trim());
  return params;
}

$("loadLedgerBtn").addEventListener("click", async () => {
  if (!selectedLedgerAccountCode && !$("ledgerAccountCode").value) return alert("اختر الحساب من البحث");
  const ledger = await api(`/api/account-ledger?${ledgerParams().toString()}`);
  renderLedger(ledger);
});

$("exportLedgerBtn").addEventListener("click", () => {
  if (!selectedLedgerAccountCode && !$("ledgerAccountCode").value) return alert("اختر الحساب من البحث");
  const params = ledgerParams();
  params.set("report", "accountLedger");
  window.location.href = `/api/reports/excel?${params.toString()}`;
});

$("ledgerAccountSearch").addEventListener("input", (event) => {
  selectedLedgerAccountCode = "";
  $("ledgerAccountCode").value = "";
  renderLedgerAccountResults(event.currentTarget.value);
});

$("ledgerAccountSearch").addEventListener("focus", (event) => {
  renderLedgerAccountResults(event.currentTarget.value);
});

$("ledgerAccountResults").addEventListener("click", (event) => {
  const button = event.target.closest(".account-result");
  if (!button) return;
  selectLedgerAccount(button.dataset.code, button.dataset.name);
});

document.addEventListener("click", (event) => {
  if (!$("ledgerPanel")?.contains(event.target)) $("ledgerAccountResults")?.classList.remove("open");
  if (!$("accountContextMenu")?.contains(event.target)) closeAccountContextMenu();
});

document.querySelectorAll("[data-export]").forEach((button) => {
  button.addEventListener("click", () => {
    window.location.href = `/api/reports/excel?report=${encodeURIComponent(button.dataset.export)}`;
  });
});

document.querySelectorAll("[data-module-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    showModule(button.dataset.moduleTarget);
    if (button.dataset.moduleTarget === "dashboardCards" || button.dataset.moduleTarget === "homePanel") await loadDashboard();
    if (button.dataset.moduleTarget === "usersPermissionsPanel") await loadUsersPermissions();
    if (button.dataset.moduleTarget === "inventoryTracePanel") await loadInventoryTrace();
    if (button.dataset.moduleTarget === "financialReportsPanel") await loadFinancialReports();
  });
});

$("refreshDashboardBtn")?.addEventListener("click", loadDashboard);
$("refreshHomeBtn")?.addEventListener("click", loadDashboard);

function financialParams() {
  const params = new URLSearchParams();
  if ($("financialDateFrom")?.value) params.set("dateFrom", $("financialDateFrom").value);
  if ($("financialDateTo")?.value) params.set("dateTo", $("financialDateTo").value);
  return params;
}

function renderFinancialReports() {
  if (!financialReports) return;
  const trial = financialReports.trialBalance || { rows: [], totals: {} };
  $("trialBalanceTable").innerHTML = (trial.rows || []).map((row) => `
    <tr>
      <td><strong>${row.code}</strong></td>
      <td>${row.name}</td>
      <td>${money(row.debit)}</td>
      <td>${money(row.credit)}</td>
      <td>${money(row.balance)}</td>
    </tr>
  `).join("") || "<tr><td colspan=\"5\">لا توجد بيانات</td></tr>";
  const tbDebit = trial.totals?.debit || 0;
  const tbCredit = trial.totals?.credit || 0;
  const tbDiff = Math.abs(tbDebit - tbCredit);
  const tbSummary = $("trialBalanceSummary");
  tbSummary.textContent = `مجموع المدين: ${money(tbDebit)} | مجموع الدائن: ${money(tbCredit)} | الفرق: ${money(tbDiff)}`;
  tbSummary.className = tbDiff < 0.01 ? "balance-ok" : "balance-error";

  const income = financialReports.statements?.incomeStatement?.totals || {};
  $("incomeStatementSummary").textContent = `قائمة الدخل | الإيرادات: ${money(income.revenues || 0)} | المصروفات: ${money(income.expenses || 0)} | صافي الربح: ${money(income.netProfit || 0)}`;

  const bs = financialReports.statements?.balanceSheet?.totals || {};
  $("balanceSheetSummary").textContent = `الميزانية العمومية | الموجودات: ${money(bs.assets || 0)} | المطلوبات + حقوق الملكية: ${money(bs.liabilitiesAndEquity || 0)}`;
}

async function loadFinancialReports() {
  const params = financialParams();
  const [trial, statements] = await Promise.all([
    api(`/api/trial-balance?${params.toString()}`),
    api(`/api/financial-statements?${params.toString()}`)
  ]);
  financialReports = { trialBalance: trial, statements };
  renderFinancialReports();
}

$("loadFinancialReportsBtn")?.addEventListener("click", loadFinancialReports);
$("exportTrialBalanceBtn")?.addEventListener("click", () => {
  const params = financialParams();
  params.set("report", "trialBalance");
  window.location.href = `/api/reports/excel?${params.toString()}`;
});
$("exportIncomeStatementBtn")?.addEventListener("click", () => {
  const params = financialParams();
  params.set("report", "incomeStatement");
  window.location.href = `/api/reports/excel?${params.toString()}`;
});
$("exportBalanceSheetBtn")?.addEventListener("click", () => {
  const params = financialParams();
  params.set("report", "balanceSheet");
  window.location.href = `/api/reports/excel?${params.toString()}`;
});

function renderInventoryTrace() {
  if (!$("inventoryTraceTable")) return;
  if (!inventoryTraceReport || !(inventoryTraceReport.items || []).length) {
    $("inventoryTraceTable").innerHTML = "<tr><td colspan=\"6\">لا توجد حركات للمادة المحددة</td></tr>";
    return;
  }
  const rows = [];
  for (const item of inventoryTraceReport.items) {
    const moves = item.moves || [];
    if (!moves.length) {
      rows.push(`
        <tr>
          <td><strong>${item.sku}</strong><br>${item.name}</td>
          <td>-</td><td>-</td><td>0</td><td>${money(item.currentQty)}</td><td>-</td>
        </tr>
      `);
    } else {
      for (const move of moves) {
        rows.push(`
          <tr>
            <td><strong>${item.sku}</strong><br>${item.name}</td>
            <td>${move.date || ""}</td>
            <td>${move.direction === "IN" ? "دخول" : "خروج"}</td>
            <td>${money(move.qty)}</td>
            <td><strong>${money(move.runningQty)}</strong></td>
            <td>${move.source || ""} ${move.sourceId ? `#${move.sourceId}` : ""}</td>
          </tr>
        `);
      }
    }
    rows.push(`
      <tr>
        <td colspan="6"><strong>رصيد أول الفترة:</strong> ${money(item.openingQty || 0)} | <strong>إجمالي دخول الفترة:</strong> ${money(item.periodQtyIn ?? item.totals?.inQty ?? 0)} | <strong>إجمالي خروج الفترة:</strong> ${money(item.periodQtyOut ?? item.totals?.outQty ?? 0)} | <strong>رصيد نهاية الفترة:</strong> ${money(item.closingQty ?? item.currentQty ?? 0)} | <strong>الرصيد الحالي:</strong> ${money(item.currentQty)}</td>
      </tr>
    `);
  }
  $("inventoryTraceTable").innerHTML = rows.join("");
}

function setAccountCodeValidationState(ok, message = "") {
  accountCodeValidationOk = ok;
  $("accountModalSubmit").disabled = $("accountModalMode").value === "add" && !ok;
  $("accountCodeValidation").textContent = message;
  $("accountCodeValidation").classList.toggle("error", !ok);
  $("accountModalCode").classList.toggle("invalid", !ok);
}

async function validateAccountCodeInput() {
  if ($("accountModalMode").value !== "add") return true;
  const result = await api("/api/accounts/validate-code", {
    method: "POST",
    body: JSON.stringify({
      code: $("accountModalCode").value.trim(),
      parentCode: $("accountModalParent").value.trim()
    })
  });
  setAccountCodeValidationState(Boolean(result.ok), result.ok ? "رقم الحساب متاح" : (result.message || "رقم الحساب غير صالح"));
  return Boolean(result.ok);
}

async function setSuggestedAccountCode(force = false) {
  if ($("accountModalMode").value !== "add") return;
  if (!force && !$("accountAutoNumber")?.checked) return;
  const parentCode = $("accountModalParent").value.trim();
  if (!parentCode) return;
  const result = await api(`/api/accounts/suggest-child?parentCode=${encodeURIComponent(parentCode)}`);
  if (!result?.suggestedCode) return;
  $("accountModalCode").value = result.suggestedCode;
  await validateAccountCodeInput();
}

function renderAccountsTree() {
  if (!$("accountsTreeTable")) return;
  const query = String($("accountsSearch").value || "").trim().toLowerCase();
  const list = [...(state.accounts || [])].sort((a, b) => (String(a.code).length - String(b.code).length) || String(a.code).localeCompare(String(b.code)));
  const children = new Map();
  list.forEach((row) => {
    const key = String(row.parentCode || "");
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(row);
  });
  const rootSet = new Set(list.map((row) => String(row.code)));
  const roots = list.filter((row) => !row.parentCode || !rootSet.has(String(row.parentCode)));
  const out = [];
  const walk = (row, depth) => {
    const kids = children.get(String(row.code)) || [];
    const hay = `${row.code} ${row.name} ${row.type || ""} ${row.level || ""}`.toLowerCase();
    const own = !query || hay.includes(query);
    const childMatch = query && kids.some((c) => `${c.code} ${c.name}`.toLowerCase().includes(query));
    if (own || childMatch || !query) out.push({ row, depth, hasChildren: kids.length > 0 });
    if (kids.length && (query || accountTreeExpanded.has(String(row.code)))) kids.forEach((k) => walk(k, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  $("accountsTreeTable").innerHTML = out.map(({ row, depth, hasChildren }) => `
    <tr class="account-tree-row" draggable="true" data-code="${row.code}" data-name="${row.name}" data-type="${row.type || ""}" data-level="${row.level || ""}" data-parent="${row.parentCode || ""}" data-currency="${row.currency || "IQD"}" data-nature="${row.nature || ""}" data-classification="${row.classification || ""}">
      <td><div class="tree-account"><span class="tree-indent" style="width:${depth * 18}px"></span>${hasChildren ? `<button type="button" class="tree-toggle" data-toggle="${row.code}">${query || accountTreeExpanded.has(String(row.code)) ? "−" : "+"}</button>` : "<span class=\"tree-indent\" style=\"width:24px\"></span>"}<strong>${row.code}</strong></div></td>
      <td>${row.name}</td><td>${row.type || ""}</td><td>${row.level || ""}</td><td>${money(row.balance)}</td>
    </tr>
  `).join("") || "<tr><td colspan=\"5\">لا توجد حسابات مطابقة</td></tr>";
}

function openAccountModal({ mode, account }) {
  $("accountModalMode").value = mode;
  if (mode === "add") {
    $("accountModalTitle").textContent = "إضافة حساب جديد";
    $("accountModalCode").value = "";
    $("accountModalName").value = "";
    $("accountModalType").value = account?.type || "موجودات";
    $("accountModalLevel").value = account?.level || "تحليلي";
    $("accountModalParent").value = account?.code || "";
    $("accountModalCurrency").value = account?.currency || "IQD";
    $("accountModalNature").value = account?.nature || "";
    $("accountModalClassification").value = account?.classification || account?.type || "";
    $("accountModalSubmit").textContent = "حفظ";
    $("accountAutoNumber").checked = true;
    setAccountCodeValidationState(false, "جاري توليد رقم فرعي...");
    setSuggestedAccountCode(true).catch((error) => setAccountCodeValidationState(false, error.message || "تعذر اقتراح رقم"));
  } else {
    $("accountModalTitle").textContent = "حذف حساب";
    $("accountModalCode").value = account?.code || "";
    $("accountModalName").value = account?.name || "";
    $("accountModalType").value = account?.type || "";
    $("accountModalLevel").value = account?.level || "";
    $("accountModalParent").value = account?.parentCode || "";
    $("accountModalCurrency").value = account?.currency || "IQD";
    $("accountModalNature").value = account?.nature || "";
    $("accountModalClassification").value = account?.classification || "";
    $("accountModalSubmit").textContent = "تأكيد الحذف";
    setAccountCodeValidationState(true, "");
  }
  $("accountModal").showModal();
}

$("accountModalCode")?.addEventListener("input", () => {
  validateAccountCodeInput().catch((error) => setAccountCodeValidationState(false, error.message || "خطأ في فحص الرقم"));
});

$("accountModalParent")?.addEventListener("input", () => {
  if ($("accountAutoNumber")?.checked) {
    setSuggestedAccountCode().catch((error) => setAccountCodeValidationState(false, error.message || "تعذر الاقتراح"));
  }
});

$("suggestAccountCodeBtn")?.addEventListener("click", () => {
  setSuggestedAccountCode(true).catch((error) => setAccountCodeValidationState(false, error.message || "تعذر الاقتراح"));
});

$("accountAutoNumber")?.addEventListener("change", () => {
  if ($("accountAutoNumber").checked) {
    setSuggestedAccountCode(true).catch((error) => setAccountCodeValidationState(false, error.message || "تعذر الاقتراح"));
  }
});

$("accountModalForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const mode = $("accountModalMode").value;
  try {
    if (mode === "add") {
      const ok = await validateAccountCodeInput();
      if (!ok) return;
      await api("/api/accounts/add", {
        method: "POST",
        body: JSON.stringify({
          code: $("accountModalCode").value.trim(),
          name: $("accountModalName").value.trim(),
          type: $("accountModalType").value.trim() || "موجودات",
          level: $("accountModalLevel").value.trim() || "تحليلي",
          parentCode: $("accountModalParent").value.trim(),
          currency: $("accountModalCurrency").value.trim() || "IQD",
          nature: $("accountModalNature").value.trim(),
          classification: $("accountModalClassification").value.trim()
        })
      });
      notify("تمت إضافة الحساب بنجاح", "ok");
    } else if (mode === "delete") {
      await api("/api/accounts/delete", {
        method: "POST",
        body: JSON.stringify({ code: $("accountModalCode").value.trim() })
      });
      notify("تم حذف الحساب بنجاح", "ok");
    }
    $("accountModal")?.close();
    await loadState();
    await loadAudit();
  } catch (error) {
    notify(error.message || "فشلت العملية", "error");
  }
}, true);

window.addEventListener("unhandledrejection", (event) => {
  notify(event.reason?.message || "حدث خطأ غير متوقع", "error");
});

showModule("homePanel");
