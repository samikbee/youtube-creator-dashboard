import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyGrowwSignals } from "./groww-signals.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(root, "data");
const snapshotsDir = join(dataDir, "snapshots");
const outputsDir = join(root, "outputs");
const latestPath = join(dataDir, "latest-portfolio.json");
const rawPath = join(dataDir, "raw-groww-latest.json");
const manualTextPath = join(dataDir, "groww-holdings-page.txt");
const displayNamesPath = join(dataDir, "stock-display-names.json");
const priceFallbackSymbols = {
  MIIL: "MIIL.BO",
  TATAGOLD: "TATAGOLD.NS",
  TITANBIO: "TITANBIO.BO"
};

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function n(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[₹,%+]/g, "").replace(/Rs\./gi, "").replace(/,/g, "").trim();
  if (!text || /^N\/?A$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function money(value, fine = true) {
  if (typeof value !== "number") return "N/A";
  return `Rs. ${value.toLocaleString("en-IN", { maximumFractionDigits: fine ? 2 : 0 })}`;
}

function pct(value) {
  if (typeof value !== "number") return "N/A";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) return null;
  return response.json();
}

async function fetchYahooQuote(yahooSymbol) {
  if (!yahooSymbol) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const previousClose = n(result.meta?.previousClose) ?? n(result.meta?.chartPreviousClose);
  const metaPrice = n(result.meta?.regularMarketPrice);
  if (metaPrice !== null) {
    return {
      price: metaPrice,
      day: previousClose ? ((metaPrice - previousClose) / previousClose) * 100 : null
    };
  }
  const closes = result.indicators?.quote?.[0]?.close || [];
  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const close = n(closes[index]);
    if (close !== null) {
      return {
        price: close,
        day: previousClose ? ((close - previousClose) / previousClose) * 100 : null
      };
    }
  }
  return null;
}

function deriveRowValues(holding) {
  if (holding.currentValue === null && holding.currentPrice !== null && holding.quantity !== null) {
    holding.currentValue = holding.currentPrice * holding.quantity;
  }
  if (holding.pnlValue === null && holding.currentValue !== null && holding.investedValue !== null) {
    holding.pnlValue = holding.currentValue - holding.investedValue;
  }
  if (holding.pnlPct === null && holding.pnlValue !== null && holding.investedValue) {
    holding.pnlPct = (holding.pnlValue / holding.investedValue) * 100;
  }
  if (!holding.browserSnapshotMatched && holding.pnlPct !== null) {
    holding.returnSource = "estimated";
  }
  return holding;
}

async function addPriceFallbacks(holdings) {
  for (const holding of holdings) {
    if (holding.currentPrice === null || holding.day === null) {
      const yahooSymbol = priceFallbackSymbols[holding.symbol] || holding.yahooSymbol;
      const quote = await fetchYahooQuote(yahooSymbol);
      if (quote === null) continue;
      holding.yahooSymbol = yahooSymbol;
      holding.currentPrice = holding.currentPrice ?? quote.price;
      holding.day = holding.day ?? quote.day;
      holding.priceSource = holding.priceSource || "yahoo-display-fallback";
    }
    deriveRowValues(holding);
  }
  return holdings;
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise(stdout);
      const error = new Error((stderr || stdout || `${command} exited with ${code}`).trim());
      error.stdout = stdout;
      error.stderr = stderr;
      rejectPromise(error);
    });
  });
}

async function readGrowwTab() {
  const evalChrome = async (js) => {
    const script = [
      "tell application \"Google Chrome\"",
      "repeat with w in windows",
      "repeat with t in tabs of w",
      "if (URL of t) contains \"groww.in/stocks/user/holdings\" then",
      `return execute t javascript ${JSON.stringify(js)}`,
      "end if",
      "end repeat",
      "end repeat",
      "return \"\"",
      "end tell"
    ];
    return run("osascript", script.flatMap((line) => ["-e", line]));
  };
  const readJs = `JSON.stringify({
    title: document.title,
    url: location.href,
    text: document.body.innerText,
    rows: Array.from(document.querySelectorAll('tr,[role="row"]'))
      .map((el) => el.innerText)
      .filter((value, index, array) => value && value.includes('shares') && array.indexOf(value) === index)
  })`;
  const rowMap = new Map();
  const textBlocks = [];
  let latest = null;
  for (let y = 0; y <= 7000; y += 420) {
    await evalChrome(`window.scrollTo(0, ${y}); ""`);
    await sleep(250);
    const stdout = await evalChrome(readJs);
    if (!stdout.trim()) continue;
    latest = JSON.parse(stdout);
    if (latest.text) textBlocks.push(latest.text);
    for (const row of latest.rows || []) {
      const key = row.replace(/\s+/g, " ").trim();
      if (key) rowMap.set(key, row);
    }
  }
  await evalChrome("window.scrollTo(0, 0); \"\"");
  if (latest) {
    latest.rows = [...rowMap.values()];
    latest.text = textBlocks.join("\n\n");
    return latest;
  }
  throw new Error("No open Groww holdings tab found in Chrome.");
}

async function readSnapshotText() {
  try {
    return await readGrowwTab();
  } catch (error) {
    if (existsSync(manualTextPath)) {
      return {
        title: "Manual Groww holdings page text",
        url: `file://${manualTextPath}`,
        text: await readFile(manualTextPath, "utf8"),
        rows: []
      };
    }
    if (/Allow JavaScript from Apple Events|Executing JavaScript through AppleScript is turned off/i.test(error.message)) {
      throw new Error("Chrome is blocking page reads. In Chrome, enable View > Developer > Allow JavaScript from Apple Events, then run npm run refresh:groww again. Alternative: copy the Groww holdings page text into data/groww-holdings-page.txt.");
    }
    throw error;
  }
}

function parseMoney(text) {
  return n((text.match(/[-+]?\s*(?:₹|Rs\.?\s*)\s*\d[\d,]*(?:\.\d+)?|(?:₹|Rs\.?\s*)\s*[-+]?\d[\d,]*(?:\.\d+)?/i) || [null])[0]);
}

function parsePercent(text) {
  return n((text.match(/[-+]?\d[\d,]*(?:\.\d+)?\s*%/) || [null])[0]);
}

function parseSignedPercent(text) {
  const value = parsePercent(text);
  if (value === null) return null;
  const percentIndex = String(text).search(/[-+]?\d[\d,]*(?:\.\d+)?\s*%/);
  const percentText = percentIndex >= 0 ? String(text).slice(percentIndex) : "";
  if (/^[+-]/.test(percentText.trim())) return value;
  const prefix = percentIndex >= 0 ? String(text).slice(0, percentIndex) : String(text);
  if (/-\s*(?:₹|Rs\.?)?\s*\d/i.test(prefix)) return -Math.abs(value);
  if (/\+\s*(?:₹|Rs\.?)?\s*\d/i.test(prefix)) return Math.abs(value);
  return value;
}

function parseSummary(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const nearby = (label) => {
    const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
    return index === -1 ? [] : lines.slice(index + 1, Math.min(lines.length, index + 8));
  };
  const getMoneyAfter = (label) => {
    for (const line of nearby(label)) {
      const value = parseMoney(line);
      if (value !== null) return value;
    }
    return null;
  };
  const getPercentAfter = (label) => {
    for (const line of nearby(label)) {
      const value = parseSignedPercent(line);
      if (value !== null) return value;
    }
    return null;
  };
  return {
    currentValue: getMoneyAfter("Current value"),
    investedValue: getMoneyAfter("Invested value"),
    dayReturnValue: getMoneyAfter("1D returns"),
    dayReturnPct: getPercentAfter("1D returns"),
    totalReturnValue: getMoneyAfter("Total returns"),
    totalReturnPct: getPercentAfter("Total returns")
  };
}

function parseRowBlock(block, index) {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const qtyIndex = lines.findIndex((line) => /^(\d+(?:\.\d+)?)\s+shares$/i.test(line));
  if (qtyIndex === -1) return null;
  const qtyMatch = lines[qtyIndex].match(/^(\d+(?:\.\d+)?)\s+shares$/i);
  const name = lines[qtyIndex - 1] || "";
  const avgLine = lines.find((line) => /^Avg\./i.test(line));
  const moneyLines = lines.map(parseMoney).filter((value) => value !== null);
  const averagePrice = parseMoney(avgLine || "");
  const priceCandidates = moneyLines.filter((value) => value !== averagePrice);
  const currentPrice = priceCandidates[0] ?? null;
  const currentValue = moneyLines.at(-2) ?? null;
  const investedValue = moneyLines.at(-1) ?? null;
  const pnlValue = currentValue !== null && investedValue !== null ? currentValue - investedValue : null;
  const pnlPct = pnlValue !== null && investedValue ? (pnlValue / investedValue) * 100 : null;
  const dayPct = parseSignedPercent(lines.find((line) => /\([-+]?\d/.test(line)) || "");
  return {
    index,
    name,
    symbol: null,
    quantity: n(qtyMatch[1]),
    averagePrice,
    currentPrice,
    currentValue,
    investedValue,
    pnlValue,
    pnlPct,
    day: dayPct
  };
}

function parseRows(text, rowBlocks = []) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = rowBlocks.map(parseRowBlock).filter(Boolean);

  const isRowName = (value) => (
    value
    && !/company.*market price/i.test(value)
    && parseMoney(value) === null
    && parseSignedPercent(value) === null
    && !/^\d+(?:\.\d+)?\s+shares$/i.test(value)
    && !/^Avg\./i.test(value)
    && !/^[-+]?₹/.test(value)
  );

  const addRow = (row) => {
    if (!row) return;
    const key = normalizeName(row.name);
    if (!key || rows.some((existing) => normalizeName(existing.name) === key)) return;
    rows.push({ ...row, index: rows.length });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const qtyMatch = lines[i].match(/^(\d+(?:\.\d+)?)\s+shares$/i);
    if (!qtyMatch) continue;
    const symbol = lines[i - 1] || "";
    const hasSymbolLine = /^[A-Z0-9&.-]{2,}$/.test(symbol) && isRowName(lines[i - 2]);
    let name = hasSymbolLine ? lines[i - 2] || symbol : symbol;
    if (!hasSymbolLine && !isRowName(name)) {
      for (let back = i - 2; back >= Math.max(0, i - 8); back -= 1) {
        if (isRowName(lines[back])) {
          name = lines[back];
          break;
        }
      }
    }
    if (!name || /^Avg\./i.test(name)) continue;

    const nextQty = lines.findIndex((line, offset) => offset > i && /^\d+(?:\.\d+)?\s+shares$/i.test(line));
    const segment = lines.slice(i, nextQty === -1 ? Math.min(lines.length, i + 28) : Math.max(i + 1, nextQty - 1));
    const avgLine = segment.find((line) => /^Avg\./i.test(line));
    const moneyLines = segment.map(parseMoney).filter((value) => value !== null);
    const currentLabel = segment.findIndex((line) => /^Current$/i.test(line));
    const investedLabel = segment.findIndex((line) => /^Invested$/i.test(line));
    const currentValue = currentLabel !== -1 ? parseMoney(segment.slice(currentLabel + 1).join("\n")) : moneyLines.at(-2) ?? null;
    const investedValue = investedLabel !== -1 ? parseMoney(segment.slice(investedLabel + 1).join("\n")) : moneyLines.at(-1) ?? null;
    const currentPrice = moneyLines.find((value) => value !== n(avgLine)) ?? null;
    const pnlPct = currentValue !== null && investedValue ? ((currentValue - investedValue) / investedValue) * 100 : null;

    addRow({
      index: rows.length,
      name,
      symbol: hasSymbolLine ? symbol : null,
      quantity: n(qtyMatch[1]),
      averagePrice: n(avgLine),
      currentPrice,
      currentValue,
      investedValue,
      pnlValue: currentValue !== null && investedValue !== null ? currentValue - investedValue : null,
      pnlPct,
      day: parseSignedPercent(segment.find((line) => /\([-+]?\d/.test(line)) || "")
    });
  }
  return rows;
}

function applyDisplayNames(holdings, displayNames) {
  return holdings.map((holding) => ({
    ...holding,
    displayName: displayNames[holding.symbol] || holding.displayName || holding.name
  }));
}

function normalizeRawHolding(holding) {
  return {
    name: holding.name,
    symbol: holding.symbol || null,
    yahooSymbol: holding.yahoo_symbol || holding.yahooSymbol || null,
    quantity: n(holding.quantity),
    averagePrice: n(holding.avg_price ?? holding.averagePrice),
    currentPrice: null,
    currentValue: null,
    investedValue: n(holding.invested_value ?? holding.investedValue),
    pnlValue: null,
    pnlPct: null,
    day: null,
    week: n(holding.week),
    month: n(holding.month),
    quarter: n(holding.qtr ?? holding.quarter),
    halfYear: n(holding.half_year ?? holding.halfYear),
    year1: n(holding.year_1 ?? holding.year1),
    year3: n(holding.year_3 ?? holding.year3),
    browserSnapshotMatched: false,
    priceSource: null
  };
}

async function readBasePortfolio(previous) {
  const raw = await readJsonIfExists(rawPath);
  if (raw?.holdings?.length) {
    return {
      ...previous,
      holdings: raw.holdings.map(normalizeRawHolding)
    };
  }
  return {
    ...previous,
    holdings: (previous.holdings || []).map((holding) => ({
      ...holding,
      displayName: null,
      currentPrice: null,
      currentValue: null,
      pnlValue: null,
      pnlPct: null,
      day: null,
      browserSnapshotMatched: false,
      priceSource: null
    }))
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function buildNameToSymbol(displayNames) {
  const entries = Object.entries(displayNames).map(([symbol, name]) => [normalizeName(name), symbol]);
  return new Map([
    ...entries,
    ["antelopusselanener", "ANTELOPUS"],
    ["bajajholdandinvest", "BAJAJHLDNG"],
    ["godfreyphillips", "GODFRYPHLP"],
    ["knowledgemarine", "KMEW"],
    ["precisionwires", "PRECWIRE"],
    ["prestigeestates", "PRESTIGE"],
    ["tatagold", "TATAGOLD"],
    ["thangamayiljeweller", "THANGAMAYL"],
    ["bajajholdinvest", "BAJAJHLDNG"],
    ["eternalzomato", "ETERNAL"],
    ["interglobeaviation", "INDIGO"],
    ["sbi", "SBIN"],
    ["landt", "LT"],
    ["groww", "GROWW"],
    ["imfa", "IMFA"],
    ["tatamotorspassenger", "TMPV"],
    ["lumaxautotech", "LUMAXTECH"],
    ["syngeneintl", "SYNGENE"],
    ["iocl", "IOC"],
    ["meghnainfraconinf", "MIIL"],
    ["marutisuzuki", "MARUTI"]
  ]);
}

function mergeHoldings(apiHoldings, browserRows, displayNames) {
  const nameToSymbol = buildNameToSymbol(displayNames);
  const bySymbol = new Map();
  const investedCounts = new Map();
  const byInvested = new Map();
  const investedKey = (value) => typeof value === "number" ? Math.round(value * 100) : null;
  for (const row of browserRows) {
    const symbol = row.symbol || nameToSymbol.get(normalizeName(row.name));
    if (symbol) bySymbol.set(symbol, { ...row, symbol });
    const key = investedKey(row.investedValue);
    if (key !== null) {
      investedCounts.set(key, (investedCounts.get(key) || 0) + 1);
      byInvested.set(key, row);
    }
  }
  return apiHoldings.map((holding) => {
    const cleanHolding = {
      ...holding,
      displayName: displayNames[holding.symbol] || holding.name,
      currentPrice: null,
      currentValue: null,
      pnlValue: null,
      pnlPct: null,
      day: null,
      browserSnapshotMatched: false,
      priceSource: null
    };
    const fallbackKey = investedKey(holding.investedValue);
    const fallbackBrowser = fallbackKey !== null && investedCounts.get(fallbackKey) === 1
      ? byInvested.get(fallbackKey)
      : null;
    const browser = bySymbol.get(holding.symbol) || fallbackBrowser;
    if (!browser) return cleanHolding;
    const quantity = fallbackBrowser && !bySymbol.get(holding.symbol)
      ? holding.quantity
      : browser.quantity ?? holding.quantity;
    const currentPrice = fallbackBrowser && !bySymbol.get(holding.symbol) && browser.currentValue !== null && holding.quantity
      ? browser.currentValue / holding.quantity
      : browser.currentPrice ?? holding.currentPrice;
    return {
      ...cleanHolding,
      displayName: bySymbol.get(holding.symbol) ? browser.name || displayNames[holding.symbol] || holding.name : displayNames[holding.symbol] || holding.name,
      quantity,
      averagePrice: browser.averagePrice ?? holding.averagePrice,
      currentPrice,
      currentValue: browser.currentValue ?? holding.currentValue,
      investedValue: browser.investedValue ?? holding.investedValue,
      pnlValue: browser.pnlValue ?? holding.pnlValue,
      pnlPct: browser.pnlPct ?? holding.pnlPct,
      day: browser.day ?? holding.day,
      browserSnapshotMatched: true
    };
  }).map((holding) => ({
    ...holding,
    displayName: displayNames[holding.symbol] || holding.displayName || holding.name
  }));
}

function buildReport(portfolio, date) {
  const holdings = [...(portfolio.holdings || [])];
  const winners = holdings.filter((h) => typeof h.pnlPct === "number").sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 8);
  const watch = holdings.filter((h) => typeof h.pnlPct === "number").sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 8);
  const rows = (items) => items.map((h) => {
    const estimate = h.returnSource === "estimated" ? "≈" : "";
    return `| ${h.displayName || h.name} | ${estimate}${pct(h.pnlPct)} | ${money(h.pnlValue)} | ${money(h.currentValue)} | ${money(h.investedValue)} |`;
  }).join("\n");
  return `Subject: Groww Portfolio Browser Snapshot - ${date}

# Groww Portfolio Browser Snapshot

Date: ${date}
Source: Groww holdings page in Chrome + cached API trend data

## Portfolio Snapshot

- Current value: ${money(portfolio.totals.currentValue)}
- Invested value: ${money(portfolio.totals.investedValue)}
- Total return: ${money(portfolio.totals.totalReturnValue)} (${pct(portfolio.totals.totalReturnPct)})
- Holdings tracked: ${portfolio.totals.holdingsCount}

## Strongest Holdings

| Stock | Total return | Gain/Loss | Current value | Invested |
|---|---:|---:|---:|---:|
${rows(winners)}

## Needs Attention

| Stock | Total return | Gain/Loss | Current value | Invested |
|---|---:|---:|---:|---:|
${rows(watch)}

This is a portfolio status report, not financial advice.
`;
}

async function main() {
  const latest = await readJsonIfExists(latestPath);
  const previous = await readBasePortfolio(latest || {});
  if (!previous?.holdings?.length) {
    throw new Error("Run npm run refresh:groww after a saved Groww cache exists.");
  }

  const snapshot = await readSnapshotText();
  const displayNames = await readJsonIfExists(displayNamesPath) || {};
  const browserRows = parseRows(snapshot.text, snapshot.rows || []);
  if (!browserRows.length) {
    throw new Error("Could not parse holdings rows from the Groww page text.");
  }

  const summary = parseSummary(snapshot.text);
  let holdings = mergeHoldings(previous.holdings || [], browserRows, displayNames);
  holdings = applyDisplayNames(await addPriceFallbacks(holdings), displayNames);
  const matched = holdings.filter((holding) => holding.browserSnapshotMatched).length;
  const currentSum = holdings.reduce((sum, holding) => sum + (holding.currentValue || 0), 0);
  const investedSum = holdings.reduce((sum, holding) => sum + (holding.investedValue || 0), 0);
  const currentValue = summary.currentValue ?? currentSum;
  const investedValue = summary.investedValue ?? investedSum;
  const totalReturnValue = summary.totalReturnValue ?? (currentValue - investedValue);
  const totalReturnPct = summary.totalReturnPct ?? (investedValue ? (totalReturnValue / investedValue) * 100 : null);
  const date = todayInTokyo();
  const reportPath = join(outputsDir, `groww-daily-report-${date}.md`);
  const portfolio = await applyGrowwSignals({
    ...previous,
    updatedAt: new Date().toISOString(),
    dataSource: "groww-browser-snapshot-api-trends",
    stale: false,
    reportFile: reportPath,
    totals: {
      ...previous.totals,
      currentValue,
      investedValue,
      dayReturnValue: previous.totals?.dayReturnValue ?? null,
      dayReturnPct: previous.totals?.dayReturnPct ?? null,
      totalReturnValue,
      totalReturnPct,
      holdingsCount: holdings.length
    },
    holdings,
    browserSnapshot: {
      importedAt: new Date().toISOString(),
      sourceTitle: snapshot.title,
      sourceUrl: snapshot.url,
      parsedRows: browserRows.length,
      matchedRows: matched
    },
    warnings: [
      ...(previous.warnings || []).filter((warning) => !/missing current price|Refresh failed|Browser snapshot matched/i.test(warning)),
      ...(matched < holdings.length ? [`Browser snapshot matched ${matched} of ${holdings.length} cached holdings.`] : [])
    ],
    dataQualityNotes: [
      "Current values come from the Groww holdings page snapshot.",
      "Cached API holdings and Yahoo trend history are used only for supplemental trend fields.",
      "Email delivery is disabled in the local command center."
    ]
  }, { dataDir });

  await mkdir(snapshotsDir, { recursive: true });
  await mkdir(outputsDir, { recursive: true });
  await writeFile(latestPath, `${JSON.stringify(portfolio, null, 2)}\n`);
  await writeFile(join(snapshotsDir, `portfolio-browser-${date}.json`), `${JSON.stringify(portfolio, null, 2)}\n`);
  await writeFile(reportPath, buildReport(portfolio, date));
  console.log(`Imported ${matched} Groww browser rows into ${latestPath}`);
  console.log(`Updated ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
