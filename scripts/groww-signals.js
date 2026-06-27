import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function readJsonIfExists(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function n(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value) {
  const number = n(value);
  return number !== null && number > 0 ? number : null;
}

function holdingKey(holding) {
  return holding.symbol || holding.yahooSymbol || holding.name;
}

function defaultNewsUrl(holding) {
  const label = encodeURIComponent(`${holding.displayName || holding.name || holding.symbol} stock negative news`);
  return `https://news.google.com/search?q=${label}`;
}

function normalizeSentimentWatchlist(raw) {
  if (Array.isArray(raw)) {
    return new Map(raw.map((item) => [item.symbol, item]).filter(([symbol]) => symbol));
  }
  return new Map(Object.entries(raw || {}).map(([symbol, item]) => [symbol, item || {}]));
}

export async function applyGrowwSignals(portfolio, { dataDir, persistHighs = true } = {}) {
  const highsPath = join(dataDir, "groww-trailing-highs.json");
  const sentimentPath = join(dataDir, "groww-sentiment-watchlist.json");
  const highs = await readJsonIfExists(highsPath, {});
  const sentiment = normalizeSentimentWatchlist(await readJsonIfExists(sentimentPath, {}));
  const updatedAt = new Date().toISOString();
  let changed = false;

  const holdings = (portfolio.holdings || []).map((holding) => {
    const key = holdingKey(holding);
    const currentPrice = positiveNumber(holding.currentPrice);
    const averagePrice = positiveNumber(holding.averagePrice);
    const previous = key ? highs[key] || {} : {};
    const previousHigh = n(previous.maxHighPrice);
    const maxHighPrice = currentPrice === null
      ? previousHigh
      : Math.max(previousHigh ?? currentPrice, averagePrice ?? currentPrice, currentPrice);
    const drawdownPct = currentPrice !== null && maxHighPrice
      ? ((currentPrice - maxHighPrice) / maxHighPrice) * 100
      : null;

    if (key && currentPrice !== null && maxHighPrice !== previousHigh) {
      highs[key] = {
        symbol: holding.symbol || null,
        name: holding.displayName || holding.name || key,
        maxHighPrice,
        firstSeenAt: previous.firstSeenAt || updatedAt,
        updatedAt
      };
      changed = true;
    }

    const sentimentEntry = sentiment.get(holding.symbol) || sentiment.get(holding.yahooSymbol) || sentiment.get(holding.name);
    const severeNegativeSentiment = Boolean(sentimentEntry?.severeNegative);
    const signal = typeof drawdownPct === "number" && drawdownPct <= -10
      ? {
          label: "Sell - broke -ve threshold",
          maxHighPrice,
          drawdownPct,
          url: null
        }
      : severeNegativeSentiment
        ? {
            label: "Sell - -ve sentiment",
            maxHighPrice,
            drawdownPct,
            url: sentimentEntry?.url || sentimentEntry?.sourceUrl || defaultNewsUrl(holding)
          }
        : {
            label: "Keep",
            maxHighPrice,
            drawdownPct,
            url: null
          };

    return {
      ...holding,
      trailingHighPrice: maxHighPrice,
      trailingDrawdownPct: drawdownPct,
      actionSignal: signal
    };
  });

  if (persistHighs && changed) {
    await writeFile(highsPath, `${JSON.stringify(highs, null, 2)}\n`);
  }

  return {
    ...portfolio,
    holdings
  };
}
