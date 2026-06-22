import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputsDir = join(root, "outputs");
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

  const mysteryItems = uniqueByTitle(mysterySources.flat()).slice(0, 9);
  const aiItems = uniqueByTitle(aiSources.flat()).slice(0, 12);

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
  console.log(`Updated ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
