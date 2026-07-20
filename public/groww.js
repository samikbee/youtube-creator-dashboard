const rs = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});
const rsFine = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});
let activePortfolio = null;
const sortState = {
  key: "pnlPct",
  direction: "desc"
};

function money(value, fine = false) {
  if (typeof value !== "number") return "No data";
  return (fine ? rsFine : rs).format(value).replace("₹", "Rs. ");
}

function pct(value, fallback = "No data") {
  if (typeof value !== "number") return fallback;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function tone(value) {
  if (typeof value !== "number" || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function dateTime(value) {
  if (!value) return "No data";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo"
  }).format(new Date(value));
}

function dataPath(path) {
  if (!location.hostname.endsWith("github.io")) return path;
  const repo = location.pathname.split("/").filter(Boolean)[0];
  const base = repo ? `/${repo}` : "";
  return `${base}/static-api${path.replace(/^\/api/, "")}.json`;
}

async function getJson(path) {
  const response = await fetch(dataPath(path));
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

function metric(label, value, className = "") {
  return `<div class="metric"><span>${label}</span><strong class="${className}">${value}</strong></div>`;
}

function renderSummary(portfolio) {
  const totals = portfolio.totals || {};
  const currentValuesMissing = (portfolio.warnings || []).some((warning) => /missing current price/i.test(warning));
  const currentValue = currentValuesMissing && totals.currentValue === 0 ? null : totals.currentValue;
  const dayReturnValue = currentValuesMissing ? null : totals.dayReturnValue;
  const dayReturnPct = currentValuesMissing ? null : totals.dayReturnPct;
  const totalReturnValue = currentValuesMissing && totals.totalReturnValue === 0 ? null : totals.totalReturnValue;
  const totalReturnPct = currentValuesMissing && totals.totalReturnPct === 0 ? null : totals.totalReturnPct;
  document.querySelector("#summaryGrid").innerHTML = [
    metric("Current value", money(currentValue)),
    metric("Invested value", money(totals.investedValue)),
    metric("Total P&L", `${money(totalReturnValue, true)} (${pct(totalReturnPct)})`, tone(totalReturnValue)),
    metric("1-day move", `${money(dayReturnValue, true)} (${pct(dayReturnPct)})`, tone(dayReturnValue)),
    metric("Holdings tracked", totals.holdingsCount ?? portfolio.holdings?.length ?? "N/A")
  ].join("");
}

function renderRankList(selector, rows, valueKey) {
  document.querySelector(selector).innerHTML = rows.length ? rows.map((row) => `
    <div class="rank-row">
      <div>
        <b>${row.displayName || row.name}</b>
        <span>${row.symbol || row.yahooSymbol || ""}${row.returnSource === "estimated" ? " · Estimated" : ""}</span>
      </div>
      <strong class="${tone(row[valueKey])}">${row.returnSource === "estimated" && valueKey === "pnlPct" ? "≈" : ""}${pct(row[valueKey])}</strong>
    </div>
  `).join("") : `<div class="empty-state">Waiting for priced Groww rows.</div>`;
}

function renderHighlights(portfolio) {
  const holdings = [...(portfolio.holdings || [])];
  const winners = holdings
    .filter((h) => typeof h.pnlPct === "number")
    .sort((a, b) => b.pnlPct - a.pnlPct)
    .slice(0, 5);
  const watchThreshold = holdings
    .filter((h) => typeof h.pnlPct === "number" && h.pnlPct <= -10)
    .sort((a, b) => a.pnlPct - b.pnlPct);
  const watch = (watchThreshold.length ? watchThreshold : holdings
    .filter((h) => typeof h.pnlPct === "number")
    .sort((a, b) => a.pnlPct - b.pnlPct)
    .slice(0, 5));
  const movers = holdings
    .filter((h) => typeof h.day === "number")
    .sort((a, b) => b.day - a.day)
    .slice(0, 5);
  renderRankList("#winnersList", winners, "pnlPct");
  renderRankList("#watchList", watch, "pnlPct");
  renderRankList("#moversList", movers, "day");
}

function cellPct(row, key) {
  const fallback = key === "pnlPct"
    ? row.browserSnapshotMatched
      ? row.investedValue === 0 ? "Cost basis 0" : "No data"
      : "Price only"
    : "No history";
  const prefix = key === "pnlPct" && row.returnSource === "estimated" && typeof row[key] === "number" ? "≈" : "";
  return `<td class="${tone(row[key])}">${prefix}${pct(row[key], fallback)}</td>`;
}

function signalRank(row) {
  const label = row.actionSignal?.label || "Keep";
  if (label.includes("broke")) return 2;
  if (label.includes("sentiment")) return 1;
  return 0;
}

function renderSignal(row) {
  const signal = row.actionSignal || { label: "Keep" };
  const isSell = signal.label.startsWith("Sell");
  const drawdown = typeof signal.drawdownPct === "number" ? `Drawdown ${pct(signal.drawdownPct)}` : "";
  const label = signal.url
    ? `<a href="${signal.url}" target="_blank" rel="noopener noreferrer">${signal.label}</a>`
    : signal.label;
  return `
    <td class="signal-cell ${isSell ? "sell" : "keep"}">
      <strong>${label}</strong>
      ${drawdown ? `<span>${drawdown}</span>` : ""}
    </td>
  `;
}

function sortValue(row, key) {
  if (key === "displayName") return row.displayName || row.name || row.symbol || "";
  if (key === "signal") return signalRank(row);
  return row[key];
}

function compareRows(a, b) {
  const aValue = sortValue(a, sortState.key);
  const bValue = sortValue(b, sortState.key);
  const aMissing = aValue === null || aValue === undefined || aValue === "";
  const bMissing = bValue === null || bValue === undefined || bValue === "";
  if (aMissing && bMissing) return (a.displayName || a.name || "").localeCompare(b.displayName || b.name || "");
  if (aMissing) return 1;
  if (bMissing) return -1;
  const direction = sortState.direction === "asc" ? 1 : -1;
  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * direction;
  }
  return String(aValue).localeCompare(String(bValue), "en", { sensitivity: "base" }) * direction;
}

function renderSortButtons() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const active = button.dataset.sort === sortState.key;
    button.classList.toggle("active", active);
    button.setAttribute("aria-sort", active ? sortState.direction : "none");
    const label = button.dataset.label || button.textContent.replace(/\s+[↑↓]$/, "");
    button.dataset.label = label;
    button.textContent = active ? `${label} ${sortState.direction === "asc" ? "↑" : "↓"}` : label;
  });
}

function priceRefreshLabel(portfolio) {
  const value = portfolio.browserSnapshot?.importedAt || portfolio.updatedAt || portfolio.asOf;
  return value ? dateTime(value) : "No refresh date";
}

function renderTable(portfolio) {
  const holdings = [...(portfolio.holdings || [])].sort(compareRows);
  const priceRefresh = priceRefreshLabel(portfolio);
  const priced = holdings.filter((h) => h.currentPrice !== null).length;
  document.querySelector("#holdingCount").textContent = `${priced} priced · ${holdings.length - priced} trend-only`;
  renderSortButtons();
  document.querySelector("#holdingsTable").innerHTML = holdings.map((row) => `
    <tr class="${row.browserSnapshotMatched ? "" : "trend-only"}">
      <td><strong>${row.displayName || row.name}</strong><br><span>${row.symbol || row.yahooSymbol || ""}</span></td>
      <td class="price-cell"><strong>${money(row.currentPrice, true)}</strong><span>${priceRefresh}</span></td>
      ${cellPct(row, "pnlPct")}
      ${cellPct(row, "day")}
      ${cellPct(row, "week")}
      ${cellPct(row, "month")}
      ${cellPct(row, "quarter")}
      ${cellPct(row, "year1")}
      ${cellPct(row, "year3")}
      <td>${money(row.currentValue)}</td>
      ${renderSignal(row)}
    </tr>
  `).join("");
}

function bindTableSorting() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (sortState.key === key) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.direction = key === "displayName" ? "asc" : "desc";
      }
      if (activePortfolio) renderTable(activePortfolio);
    });
  });
}

function renderQuality(portfolio) {
  const matched = portfolio.browserSnapshot?.matchedRows;
  const parsed = portfolio.browserSnapshot?.parsedRows;
  const notes = [
    `Updated: ${dateTime(portfolio.updatedAt)}`,
    `Data source: ${portfolio.dataSource || "unknown"}`,
    matched !== undefined ? `Groww page rows imported: ${matched}/${portfolio.totals?.holdingsCount || portfolio.holdings?.length || parsed}` : null,
    `Stale cache: ${portfolio.stale ? "Yes" : "No"}`,
    "Email delivery: Disabled",
    ...(portfolio.dataQualityNotes || []),
    ...(portfolio.warnings || []).map((warning) => `Warning: ${warning}`),
    ...(portfolio.errors || []).map((error) => `Error: ${error}`)
  ].filter(Boolean);
  document.querySelector("#qualityPanel").innerHTML = notes.map((note) => `
    <div class="quality-row"><span>${note}</span></div>
  `).join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderScreener(screener) {
  const meta = document.querySelector("#screenerMeta");
  const sourceLink = document.querySelector("#screenerSourceLink");
  const head = document.querySelector("#screenerHead");
  const body = document.querySelector("#screenerRows");
  if (!meta || !head || !body) return;
  const rows = screener.rows || [];
  const headers = screener.headers || [];
  const updated = screener.updatedAt ? dateTime(screener.updatedAt) : "No data";
  meta.textContent = rows.length
    ? `${screener.pageLabel || `${rows.length} results found`} · Updated ${updated} · ${screener.stale ? "stale cache" : screener.dataSource || "saved cache"}`
    : "No Screener results saved yet. Run npm run refresh:screener.";
  if (sourceLink && screener.sourceUrl) sourceLink.href = screener.sourceUrl;
  head.innerHTML = headers.length ? `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>` : "";
  body.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      ${(row.cells || []).map((cell, index) => {
        const value = escapeHtml(cell);
        const isName = index === 1 && row.href;
        return `<td>${isName ? `<a href="${row.href}" target="_blank" rel="noreferrer">${value}</a>` : value}</td>`;
      }).join("")}
    </tr>
  `).join("") : `<tr><td class="empty-state" colspan="${Math.max(1, headers.length)}">No Screener cache available.</td></tr>`;
}

function renderStatus(portfolio) {
  const pill = document.querySelector("#statusPill");
  const source = portfolio.dataSource || "unknown";
  const isSample = source.includes("sample");
  pill.textContent = portfolio.stale ? "Stale cache" : isSample ? "Sample data" : "Live cache";
  pill.className = `status-pill ${portfolio.stale ? "stale" : isSample ? "sample" : "live"}`;
}

async function main() {
  const [portfolio, report, screener] = await Promise.all([
    getJson("/api/groww/portfolio"),
    getJson("/api/groww/report"),
    getJson("/api/groww/screener")
  ]);
  activePortfolio = portfolio;
  renderStatus(portfolio);
  renderSummary(portfolio);
  renderHighlights(portfolio);
  renderTable(portfolio);
  renderQuality(portfolio);
  renderScreener(screener);
  document.querySelector("#reportSource").textContent = report.sourceFile || "";
  document.querySelector("#reportPreview").textContent = report.markdown || "";
  bindTableSorting();
}

main().catch((error) => {
  document.querySelector("#statusPill").textContent = error.message;
  document.querySelector("#statusPill").className = "status-pill stale";
});
