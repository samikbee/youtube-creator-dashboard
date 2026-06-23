import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(root, "data");
const snapshotsDir = join(dataDir, "snapshots");
const latestPath = join(dataDir, "latest-screener.json");
const screenerUrl = process.env.SCREENER_QUERY_URL || "https://www.screener.in/screen/raw/?sort=market+capitalization&order=desc&source_id=&query=Market+Capitalization+%3E+500%0D%0AAND+Current+price+%3E+50%0D%0AAND+Return+over+1day+%3E+0%0D%0AAND+Return+over+1week+%3E+0%0D%0AAND+Return+over+1month+%3E+10%0D%0AAND+Return+over+3months+%3E+25%0D%0AAND+Return+over+1year+%3E+50%0D%0AAND+Return+over+3years+%3E+50%0D%0AAND+Sales+growth+3Years+%3E+5%0D%0AAND+Profit+growth+3Years+%3E+5%0D%0AAND+Return+on+capital+employed+%3E+12%0D%0AAND+Return+on+equity+%3E+10%0D%0AAND+Promoter+holding+%3E+35%0D%0AAND+Pledged+percentage+%3C+5";

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value = "") {
  return cleanText(value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));
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

function parseTableFromHtml(html, source = "public-fetch") {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table) return null;
  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => stripTags(match[1]));
  const body = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || table;
  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cellMatch) => stripTags(cellMatch[1]));
    const href = rowMatch[1].match(/<a[^>]+href=["']([^"']+)["']/i)?.[1] || null;
    return { cells, href: href ? new URL(href, "https://www.screener.in").href : null };
  }).filter((row) => row.cells.length && row.cells[0] !== "S.No.");
  if (!headers.length || !rows.length) return null;
  return {
    updatedAt: new Date().toISOString(),
    dataSource: source,
    sourceUrl: screenerUrl,
    resultCount: rows.length,
    pageLabel: null,
    headers,
    rows,
    warnings: []
  };
}

async function fetchPublicScreener() {
  const response = await fetch(screenerUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  const html = await response.text();
  const parsed = parseTableFromHtml(html, "screener-public-fetch");
  if (parsed) return parsed;
  return {
    status: response.status,
    title: html.match(/<title>(.*?)<\/title>/i)?.[1] || "",
    error: "Public Screener fetch did not return a results table."
  };
}

async function readScreenerChromeTab() {
  const js = `JSON.stringify({
    title: document.title,
    url: location.href,
    resultText: document.body.innerText.match(/\\d+ results found[^\\n]*/)?.[0] || "",
    headers: Array.from((document.querySelector("table thead tr") || document.querySelector("table tr") || {}).children || []).map((cell) => cell.innerText.trim()),
    rows: Array.from(document.querySelectorAll("table tbody tr")).map((tr) => ({
      cells: Array.from(tr.children).map((cell) => cell.innerText.trim()),
      href: tr.querySelector("a[href]") ? new URL(tr.querySelector("a[href]").getAttribute("href"), location.origin).href : null
    })).filter((row) => row.cells.length && row.cells[0] !== "S.No."),
    query: document.querySelector("textarea")?.value || ""
  })`;
  const script = [
    "tell application \"Google Chrome\"",
    "repeat with w in windows",
    "repeat with t in tabs of w",
    "if (URL of t) contains \"screener.in/screen/raw\" then",
    `return execute t javascript ${JSON.stringify(js)}`,
    "end if",
    "end repeat",
    "end repeat",
    "return \"\"",
    "end tell"
  ];
  const stdout = await run("osascript", script.flatMap((line) => ["-e", line]));
  if (!stdout.trim()) throw new Error("No open Screener query tab found in Chrome.");
  const data = JSON.parse(stdout);
  if (!data.rows?.length || !data.headers?.length) {
    throw new Error("The open Screener tab does not contain a readable results table.");
  }
  return {
    updatedAt: new Date().toISOString(),
    dataSource: "screener-chrome-snapshot",
    sourceUrl: data.url || screenerUrl,
    sourceTitle: data.title || "Screener query",
    resultCount: Number(data.resultText?.match(/\d+/)?.[0]) || data.rows.length,
    pageLabel: data.resultText || null,
    query: data.query || null,
    headers: data.headers,
    rows: data.rows,
    warnings: []
  };
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(latestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  let data = await fetchPublicScreener();
  if (!data.rows?.length) {
    const publicError = data;
    try {
      data = await readScreenerChromeTab();
      data.warnings.push("Screener required a logged-in Chrome page; public fetch was not usable.");
      data.publicFetchError = publicError;
    } catch (error) {
      const previous = await readPrevious();
      if (previous?.rows?.length) {
        previous.stale = true;
        previous.warnings = [
          `Refresh failed: ${error.message}`,
          ...(previous.warnings || [])
        ];
        await writeFile(latestPath, `${JSON.stringify(previous, null, 2)}\n`);
        console.error(error.message);
        console.error("Existing Screener cache marked stale.");
        return;
      }
      throw new Error(`${error.message} Open the Screener query in Chrome, stay logged in, then rerun npm run refresh:screener.`);
    }
  }
  data.stale = false;
  data.refreshedAtTokyoDate = todayInTokyo();
  await mkdir(dataDir, { recursive: true });
  await mkdir(snapshotsDir, { recursive: true });
  await writeFile(latestPath, `${JSON.stringify(data, null, 2)}\n`);
  await writeFile(join(snapshotsDir, `screener-${todayInTokyo()}.json`), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Updated ${latestPath}`);
  console.log(`Saved ${data.rows.length} Screener rows from ${data.dataSource}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
