import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputsDir = join(root, "outputs");
const dataDir = join(root, "data");
const historyPath = join(dataDir, "recommendation-history.json");
const userAgent = "Mozilla/5.0 (compatible; CreatorDashboardBot/1.0)";

function todayInTokyo() {
  return process.env.REPORT_DATE || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function cleanTitle(value = "") {
  return decodeXml(value)
    .replace(/\s+-\s+[^-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceName(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function normalizeKey(value = "") {
  return String(value).toLowerCase().replace(/https?:\/\/news\.google\.com\/rss\/articles\//g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function itemKey(item) {
  return normalizeKey(`${item.title} ${item.link || item.links?.[0]?.url || ""}`);
}

function historyKey(item) {
  return normalizeKey(`${item.title} ${item.links?.[0]?.url || item.link || ""}`);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": userAgent
    }
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function parseRss(xml, fallbackCategory) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const title = cleanTitle(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
    const link = decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "");
    const pubDate = decodeXml(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "");
    const source = decodeXml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || sourceName(link));
    return { title, link, pubDate, source, category: fallbackCategory };
  }).filter((item) => item.title && item.link);
}

async function googleNews(query, category) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:7d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  try {
    return parseRss(await fetchText(url), category);
  } catch (error) {
    console.warn(`Google News fetch failed for ${category}: ${error.message}`);
    return [];
  }
}

async function hackerNewsAi() {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
  url.searchParams.set("query", "AI OR OpenAI OR Anthropic OR Gemini OR Claude");
  url.searchParams.set("tags", "story");
  url.searchParams.set("numericFilters", `created_at_i>${sevenDaysAgo}`);
  url.searchParams.set("hitsPerPage", "20");
  try {
    const data = JSON.parse(await fetchText(url));
    return (data.hits || [])
      .filter((item) => item.title && (item.url || item.story_url))
      .map((item) => ({
        title: item.title,
        link: item.url || item.story_url,
        source: sourceName(item.url || item.story_url),
        pubDate: item.created_at?.slice(0, 10) || todayInTokyo(),
        points: item.points || 0,
        comments: item.num_comments || 0,
        category: "AI news"
      }));
  } catch (error) {
    console.warn(`Hacker News fetch failed: ${error.message}`);
    return [];
  }
}

function uniqueByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removePreviousRecommendations(items, history) {
  const oldKeys = new Set((history.items || []).map(historyKey));
  const oldTitles = new Set((history.items || []).map((item) => normalizeKey(item.title)));
  return items.filter((item) => !oldKeys.has(itemKey(item)) && !oldTitles.has(normalizeKey(item.title)));
}

function titleCaseIdea(title) {
  const trimmed = title.replace(/^the\s+/i, "").trim();
  return trimmed.length > 78 ? `${trimmed.slice(0, 75)}...` : trimmed;
}

function mysteryHook(item) {
  const lower = item.title.toLowerCase();
  if (lower.includes("ufo") || lower.includes("uap")) {
    return "A new official-looking clue is circulating, but the answer is still missing.";
  }
  if (lower.includes("archaeolog") || lower.includes("ancient") || lower.includes("tomb")) {
    return "Something buried for centuries is back in the news, and the unanswered detail is the hook.";
  }
  if (lower.includes("stonehenge") || lower.includes("monument")) {
    return "A famous ancient site may have a missing chapter, and the timeline just changed.";
  }
  return "This looks like a normal discovery until you ask the one question nobody can fully answer.";
}

function aiSummary(item) {
  if (item.points || item.comments) {
    return `Fresh AI story with ${item.points} Hacker News points and ${item.comments} comments at collection time.`;
  }
  return "Fresh AI story from public news/RSS sources collected for today's dashboard.";
}

function parseLinks(line) {
  return [...line.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
    .map(([, label, url]) => ({ label, url }));
}

function parseExistingReport(markdown, filename) {
  const date = markdown.match(/^Date:\s*(.+)$/m)?.[1]?.trim() || filename.replace(/^daily-report-|\.(md)$/g, "");
  const items = [];
  let type = "";
  let current = null;

  const push = () => {
    if (!current) return;
    current.id = `${current.date}-${current.type}-${normalizeKey(current.title).slice(0, 40)}`;
    items.push(current);
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## Section 1")) {
      push();
      type = "video";
      continue;
    }
    if (line.startsWith("## Section 2")) {
      push();
      type = "ai";
      continue;
    }
    const itemMatch = line.match(/^####?\s+(\d+)\.\s+(.+)$/);
    if (itemMatch && type) {
      push();
      current = {
        date,
        type,
        number: Number(itemMatch[1]),
        title: cleanTitle(itemMatch[2]).replace(/^"|"$/g, ""),
        summary: "",
        signal: "",
        sourceFile: filename,
        links: []
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("- 30-second hook angle:")) current.summary = line.replace("- 30-second hook angle:", "").trim().replace(/^"|"$/g, "");
    if (line.startsWith("- Short summary:")) current.summary = line.replace("- Short summary:", "").trim();
    if (line.startsWith("- Engagement signal")) current.signal = line.replace(/^- Engagement signal[^:]*:\s*/, "").trim();
    current.links.push(...parseLinks(line));
  }
  push();
  return items;
}

async function seedHistoryFromReports() {
  const files = (await readdir(outputsDir))
    .filter((name) => /^daily-report-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  const items = [];
  for (const file of files) {
    const markdown = await readFile(join(outputsDir, file), "utf8");
    items.push(...parseExistingReport(markdown, file));
  }
  return {
    updatedAt: new Date().toISOString(),
    items: trimHistory(items)
  };
}

async function loadHistory() {
  const history = await readJsonIfExists(historyPath);
  if (history?.items?.length) return history;
  return seedHistoryFromReports();
}

function historyEntry(item, date, type, index) {
  const title = titleCaseIdea(item.title);
  return {
    id: `${date}-${type}-${index + 1}-${normalizeKey(title).slice(0, 36)}`,
    date,
    type,
    number: index + 1,
    title,
    summary: type === "video" ? mysteryHook(item) : aiSummary(item),
    signal: type === "video"
      ? "Fresh public news pickup; use YouTube search link to verify current video traction before filming."
      : (item.points || item.comments ? `${item.points} points / ${item.comments} comments on Hacker News` : "Public news/RSS pickup"),
    source: item.source || sourceName(item.link),
    links: [{ label: item.source || sourceName(item.link), url: item.link }]
  };
}

function trimHistory(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      const key = historyKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.type || "").localeCompare(b.type || ""))
    .slice(0, 1000);
}

async function saveHistory(date, mysteryItems, aiItems, previousHistory) {
  await mkdir(dataDir, { recursive: true });
  const newItems = [
    ...mysteryItems.map((item, index) => historyEntry(item, date, "video", index)),
    ...aiItems.map((item, index) => historyEntry(item, date, "ai", index))
  ];
  const history = {
    updatedAt: new Date().toISOString(),
    maxItems: 1000,
    items: trimHistory([...newItems, ...(previousHistory.items || [])])
  };
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
}

function mysteryMarkdown(items) {
  return items.slice(0, 9).map((item, index) => {
    const title = titleCaseIdea(item.title);
    return `#### ${index + 1}. ${title}
- Title: "${title}"
- Bucket: ${item.category || "News/source bucket"}
- Source links:
  - [${item.source || sourceName(item.link)}](${item.link})
  - [YouTube search for Shorts angle](https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} mystery shorts`)})
- Date/recency: ${item.pubDate || todayInTokyo()}
- Engagement signal: Fresh public news pickup; use YouTube search link to verify current video traction before filming.
- Why it is trending or likely to perform: ${item.title} is recent, specific, and has a built-in curiosity gap.
- 30-second hook angle: "${mysteryHook(item)}"
- Suggested visuals: Source headline, map/photo context, timeline overlay, one zoomed-in clue, comment-style question.
- Best for: curiosity
- Confidence score: ${Math.max(6.5, 9 - index * 0.25).toFixed(1)}/10`;
  }).join("\n\n");
}

function aiMarkdown(items) {
  return items.slice(0, 12).map((item, index) => {
    const title = titleCaseIdea(item.title);
    return `### ${index + 1}. ${title}
- Headline/title: ${title}
- Source/platform: ${item.source || sourceName(item.link)}
- Source link: [${item.source || sourceName(item.link)}](${item.link})
- Date/recency: ${item.pubDate || todayInTokyo()}
- Short summary: ${aiSummary(item)}
- Why it matters: Use this as a simple explainer topic for MittiMic: what changed, who it affects, and one practical example.
- Engagement signal if available: ${item.points || item.comments ? `${item.points} points / ${item.comments} comments on Hacker News` : "Public news/RSS pickup"}
- Category: AI news trend`;
  }).join("\n\n");
}

async function main() {
  const date = todayInTokyo();
  await mkdir(outputsDir, { recursive: true });
  const history = await loadHistory();

  const mysterySources = await Promise.all([
    googleNews("archaeology mystery ancient discovery tomb", "Archaeology mystery"),
    googleNews("UFO UAP mystery official video", "UFO mystery"),
    googleNews("ancient monument mystery Stonehenge discovery", "Ancient monument mystery"),
    googleNews("science mystery discovery unexplained", "Science mystery")
  ]);
  const aiSources = await Promise.all([
    hackerNewsAi(),
    googleNews("OpenAI OR Anthropic OR Gemini AI product update", "AI news"),
    googleNews("AI startup funding model release", "AI news")
  ]);

  const mysteryItems = removePreviousRecommendations(uniqueByTitle(mysterySources.flat()), history).slice(0, 9);
  const aiItems = removePreviousRecommendations(uniqueByTitle(aiSources.flat()), history).slice(0, 12);

  if (mysteryItems.length < 5 || aiItems.length < 5) {
    throw new Error(
      `Not enough source items to build a safe report: ${mysteryItems.length} mystery, ${aiItems.length} AI.`
    );
  }

  const markdown = `# Daily Trend Ideas and AI News

Date: ${date}

## Section 1: World Mystery Video Ideas for YouTube Shorts

### A) Daily public-source recommendations

${mysteryMarkdown(mysteryItems)}

## Section 2: AI News and AI Video Trends

${aiMarkdown(aiItems)}
`;

  const outputPath = join(outputsDir, `daily-report-${date}.md`);
  await writeFile(outputPath, markdown);
  await saveHistory(date, mysteryItems, aiItems, history);
  console.log(`Updated ${outputPath}`);
  console.log(`Updated ${historyPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
