import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
await loadEnv(join(root, ".env.local"));

const publicDir = join(root, "public");
const outputsDir = join(root, "outputs");
const dataDir = join(root, "data");
const port = Number(process.env.PORT || 4173);
const host = process.env.RENDER ? "0.0.0.0" : "127.0.0.1";
const channelSources = [
  {
    id: "zero-known",
    name: "Zero Known",
    handle: "@Zero_Known",
    url: "https://www.youtube.com/@Zero_Known"
  },
  {
    id: "mittimic",
    name: "MittiMic",
    handle: "@MittiMic",
    url: "https://www.youtube.com/@MittiMic"
  }
];
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function loadEnv(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function hasYoutubeDashboardApiKey() {
  return Boolean(process.env.YOUTUBE_CHHAV_100_API_KEY || process.env.YOUTUBE_DASHBOARD_API_KEY || process.env.YOUTUBE_API_KEY);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function readJson(name) {
  return JSON.parse(await readFile(join(dataDir, name), "utf8"));
}

async function readJsonOrNull(name) {
  try {
    return await readJson(name);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function analytics() {
  if (process.env.USE_MOCK_ANALYTICS === "1") {
    return { ...(await readJson("mock-analytics.json")), dataSource: "sample" };
  }
  const cached = await readJsonOrNull("latest-analytics.json");
  if (cached) return cached;
  return {
    ...(await readJson("mock-analytics.json")),
    dataSource: "sample-fallback",
    privateMetricsAvailable: false,
    publicFetchError: "No data/latest-analytics.json file found yet. Run npm run refresh:analytics to create the first local cache."
  };
}

function parseRecommendationReport(markdown, filename) {
  const date = markdown.match(/^Date:\s*(.+)$/m)?.[1]?.trim() || filename.replace(/\D/g, "-");
  const mystery = [];
  const ai = [];
  let currentSection = "";
  let current = null;

  const push = () => {
    if (!current) return;
    if (currentSection === "mystery") mystery.push(current);
    if (currentSection === "ai") ai.push(current);
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## Section 1")) {
      push();
      currentSection = "mystery";
      continue;
    }
    if (line.startsWith("## Section 2")) {
      push();
      currentSection = "ai";
      continue;
    }
    const itemMatch = line.match(/^####?\s+(\d+)\.\s+(.+)$/);
    if (itemMatch && currentSection) {
      push();
      current = {
        id: `${currentSection}-${itemMatch[1]}`,
        number: Number(itemMatch[1]),
        title: itemMatch[2].trim(),
        links: []
      };
      continue;
    }
    if (!current) continue;

    const pair = line.match(/^- ([^:]+):\s*(.+)$/);
    if (pair) {
      const key = pair[1].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      current[key] = pair[2].trim();
    }

    const images = [...line.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)];
    for (const [, , url] of images) current.image_url ||= url;

    const links = [...line.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
    for (const [, label, url] of links) current.links.push({ label, url });
  }
  push();

  return {
    date,
    sourceFile: filename,
    mystery: mystery.slice(0, 9),
    ai: ai.slice(0, 12)
  };
}

async function latestRecommendation() {
  const files = (await readdir(outputsDir))
    .filter((name) => /^daily-report-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  const latest = files.at(-1);
  if (!latest) return { date: null, sourceFile: null, updatedAt: null, mystery: [], ai: [] };
  const report = parseRecommendationReport(await readFile(join(outputsDir, latest), "utf8"), latest);
  return {
    ...report,
    updatedAt: report.date ? `${report.date}T08:00:00+09:00` : null
  };
}

function historyItemsFromReport(report) {
  return [
    ...(report.mystery || []).map((item) => ({
      ...item,
      date: report.date,
      type: "video",
      sourceFile: report.sourceFile,
      summary: item["30_second_hook_angle"] || item.why_it_is_trending_or_likely_to_perform || ""
    })),
    ...(report.ai || []).map((item) => ({
      ...item,
      date: report.date,
      type: "ai",
      sourceFile: report.sourceFile,
      summary: item.short_summary || item.why_it_matters || ""
    }))
  ];
}

async function recommendationHistoryFromReports() {
  const files = (await readdir(outputsDir))
    .filter((name) => /^daily-report-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  const items = [];
  for (const file of files) {
    const report = parseRecommendationReport(await readFile(join(outputsDir, file), "utf8"), file);
    items.push(...historyItemsFromReport(report));
  }
  return {
    updatedAt: new Date().toISOString(),
    maxItems: 1000,
    items: items
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.type || "").localeCompare(b.type || ""))
      .slice(0, 1000)
  };
}

async function recommendationHistory() {
  const cached = await readJsonOrNull("recommendation-history.json");
  if (cached?.items?.length) return cached;
  return recommendationHistoryFromReports();
}


async function growwPortfolio() {
  const cached = await readJsonOrNull("latest-portfolio.json");
  if (cached && (cached.holdings || []).length) return cached;
  return {
    updatedAt: null,
    dataSource: "groww-cache-missing",
    stale: true,
    totals: {
      currentValue: null,
      investedValue: null,
      dayReturnValue: null,
      dayReturnPct: null,
      totalReturnValue: null,
      totalReturnPct: null,
      holdingsCount: 0
    },
    holdings: [],
    warnings: ["No Groww portfolio cache is available yet. Run npm run refresh:groww locally after opening the Groww holdings page."]
  };
}

function hasGrowwCredentials() {
  return Boolean(
    process.env.GROWW_API_AUTH_TOKEN
    || (process.env.GROWW_TOTP_TOKEN && process.env.GROWW_TOTP_SECRET)
    || (process.env.GROWW_API_KEY && (process.env.GROWW_API_SECRET || process.env.GROWW_API_TOTP))
  );
}

async function latestScreener() {
  const cached = await readJsonOrNull("latest-screener.json");
  if (cached?.rows?.length) return cached;
  return {
    updatedAt: null,
    dataSource: "screener-cache-missing",
    stale: true,
    sourceUrl: "https://www.screener.in/screen/raw/?sort=market+capitalization&order=desc&source_id=&query=Market+Capitalization+%3E+500%0D%0AAND+Current+price+%3E+50%0D%0AAND+Return+over+1day+%3E+0%0D%0AAND+Return+over+1week+%3E+0%0D%0AAND+Return+over+1month+%3E+10%0D%0AAND+Return+over+3months+%3E+25%0D%0AAND+Return+over+1year+%3E+50%0D%0AAND+Return+over+3years+%3E+50%0D%0AAND+Sales+growth+3Years+%3E+5%0D%0AAND+Profit+growth+3Years+%3E+5%0D%0AAND+Return+on+capital+employed+%3E+12%0D%0AAND+Return+on+equity+%3E+10%0D%0AAND+Promoter+holding+%3E+35%0D%0AAND+Pledged+percentage+%3C+5",
    resultCount: 0,
    headers: [],
    rows: [],
    warnings: ["No Screener cache is available yet. Run npm run refresh:screener after opening the Screener query in Chrome."]
  };
}

async function latestGrowwReport() {
  const files = (await readdir(outputsDir))
    .filter((name) => /^groww-daily-report-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  const latest = files.at(-1);
  if (!latest) {
    return {
      sourceFile: null,
      markdown: "No Groww report file found yet. Run npm run refresh:groww locally to update the saved portfolio snapshot."
    };
  }
  return {
    sourceFile: latest,
    markdown: await readFile(join(outputsDir, latest), "utf8")
  };
}

async function routeApi(req, res) {
  if (req.url === "/api/groww/portfolio") {
    return send(res, 200, JSON.stringify(await growwPortfolio(), null, 2));
  }
  if (req.url === "/api/groww/report") {
    return send(res, 200, JSON.stringify(await latestGrowwReport(), null, 2));
  }
  if (req.url === "/api/groww/screener") {
    return send(res, 200, JSON.stringify(await latestScreener(), null, 2));
  }
  if (req.url === "/api/groww/debug") {
    const current = await growwPortfolio();
    const report = await latestGrowwReport();
    return send(res, 200, JSON.stringify({
      portfolioCacheFile: join(dataDir, "latest-portfolio.json"),
      reportSourceFile: report.sourceFile,
      dataSource: current.dataSource,
      updatedAt: current.updatedAt || null,
      stale: Boolean(current.stale),
      holdings: current.holdings?.length || 0,
      browserSnapshot: current.browserSnapshot || null,
      growwCredentialsConfigured: hasGrowwCredentials(),
      pageRequestsUseCachedFiles: true,
      note: "Groww is served as a saved public snapshot inside the creator dashboard."
    }, null, 2));
  }
  if (req.url === "/api/groww/integrations") {
    return send(res, 200, JSON.stringify({
      growwApi: hasGrowwCredentials(),
      yahooFallback: true,
      portfolioProvider: "data/latest-portfolio.json",
      reportProvider: "outputs/groww-daily-report-YYYY-MM-DD.md",
      gmailDelivery: false,
      note: "The deployed page reads saved Groww files only. Refresh locally with npm run refresh:groww."
    }, null, 2));
  }

  if (req.url === "/api/analytics") {
    return send(res, 200, JSON.stringify(await analytics()));
  }
  if (req.url === "/api/debug") {
    const result = await analytics();
    const recommendations = await latestRecommendation();
    return send(res, 200, JSON.stringify({
      projectRoot: root,
      dataSource: result.dataSource,
      publicFetchError: result.publicFetchError || null,
      analyticsCacheFile: join(dataDir, "latest-analytics.json"),
      recommendationSourceFile: recommendations.sourceFile,
      channels: result.channels.map((channel) => ({
        name: channel.name,
        handle: channel.handle,
        videos: channel.videos.length,
        firstVideo: channel.videos[0]?.title || null
      })),
      needsRestartAfterCodeChanges: true,
      pageRequestsUseCachedFiles: true,
      youtubeApiKeyConfigured: hasYoutubeDashboardApiKey()
    }, null, 2));
  }
  if (req.url === "/api/recommendations" || req.url === "/api/refresh") {
    return send(res, 200, JSON.stringify(await latestRecommendation()));
  }
  if (req.url === "/api/recommendation-history") {
    return send(res, 200, JSON.stringify(await recommendationHistory()));
  }
  if (req.url === "/api/integrations") {
    return send(res, 200, JSON.stringify({
      youtubeDataApi: hasYoutubeDashboardApiKey(),
      recommendationProvider: process.env.RECOMMENDATION_PROVIDER || "daily-report-files",
      analyticsProvider: "data/latest-analytics.json",
      publicYouTubeFetch: false,
      note: "The website reads precomputed local files. Run npm run refresh:analytics daily to update public YouTube metrics."
    }));
  }
  send(res, 404, JSON.stringify({ error: "Not found" }));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return routeApi({ ...req, url: url.pathname }, res);

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname === "/groww" ? "/groww.html" : decodeURIComponent(url.pathname);
    const filePath = resolve(join(publicDir, pathname));
    if (!filePath.startsWith(publicDir)) return send(res, 403, "Forbidden", "text/plain");
    const body = await readFile(filePath);
    send(res, 200, body, mimeTypes[extname(filePath)] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") return send(res, 404, "Not found", "text/plain");
    send(res, 500, JSON.stringify({ error: error.message }));
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Set PORT to another value or stop the existing server.`);
    process.exit(1);
  }
  if (error.code === "EPERM") {
    console.error(`Permission blocked listening on ${host}:${port}. Check local network permissions or try another port.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Creator Command Center running at http://localhost:${port}`);
});
