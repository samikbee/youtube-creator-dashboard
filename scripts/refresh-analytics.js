import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(root, "data");
const snapshotsDir = join(dataDir, "snapshots");
const latestPath = join(dataDir, "latest-analytics.json");
const youtubeApiBase = "https://www.googleapis.com/youtube/v3";
const channels = [
  {
    id: "zero-known",
    name: "Zero Known",
    handle: "@Zero_Known",
    channelId: "UCXsuQjPtwHfGJwSj6mF4YTQ",
    url: "https://www.youtube.com/@Zero_Known",
    topic: "World Mystery"
  },
  {
    id: "mittimic",
    name: "MittiMic",
    handle: "@MittiMic",
    channelId: "UCYZgEYwfsk1f49lBgKnf2Vg",
    url: "https://www.youtube.com/@MittiMic",
    topic: "AI News"
  }
];

await loadEnv(join(root, ".env.local"));

function getYoutubeApiKey() {
  return process.env.YOUTUBE_CHHAV_100_API_KEY || process.env.YOUTUBE_DASHBOARD_API_KEY || process.env.YOUTUBE_API_KEY || "";
}

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

function parseViewCount(text = "") {
  const normalized = String(text).replace(/\u00a0/g, " ").trim().toLowerCase();
  if (!normalized || normalized.includes("no views")) return 0;
  const match = normalized.match(/([\d,.]+)\s*([km]?)\s*views?/);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ""));
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.round(number * multiplier);
}

function parseIsoDuration(value = "") {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return value || "Unknown";
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const parts = hours
    ? [hours, String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")]
    : [minutes, String(seconds).padStart(2, "0")];
  return parts.join(":");
}

function textFromRuns(value) {
  if (!value) return "";
  if (value.simpleText) return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
  return "";
}

function decodeXml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function findInitialData(html) {
  const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)
    || html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s);
  return match ? JSON.parse(match[1]) : null;
}

function statusForViews(views) {
  if (views >= 500000) return "Breakout";
  if (views >= 100000) return "Rising";
  return "Public";
}

function collectVideos(initialData, channel) {
  const seen = new Set();
  const videos = [];

  function walk(value) {
    if (!value || typeof value !== "object") return;
    const renderer = value.videoRenderer || value.gridVideoRenderer || value.reelItemRenderer;
    if (renderer?.videoId && !seen.has(renderer.videoId)) {
      seen.add(renderer.videoId);
      const title = textFromRuns(renderer.title || renderer.headline) || "Untitled video";
      const rawViews = textFromRuns(renderer.viewCountText || renderer.shortViewCountText);
      const views = parseViewCount(rawViews);
      videos.push({
        id: renderer.videoId,
        title,
        url: `https://www.youtube.com/watch?v=${renderer.videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${renderer.videoId}/hqdefault.jpg`,
        publishedAt: textFromRuns(renderer.publishedTimeText) || "Unknown",
        duration: textFromRuns(renderer.lengthText) || "Unknown",
        views: views ?? 0,
        viewsDelta1d: null,
        likes: null,
        likesDelta1d: null,
        status: statusForViews(views ?? 0),
        topic: channel.topic,
        isPublicData: true
      });
    }
    for (const child of Object.values(value)) walk(child);
  }

  walk(initialData);
  return videos
    .filter((video) => video.title && !video.title.toLowerCase().includes("deleted video"))
    .slice(0, 30);
}

async function fetchPublicChannel(channel) {
  const response = await fetch(`${channel.url}/videos`, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error(`YouTube returned ${response.status} for ${channel.handle}`);
  const html = await response.text();
  const initialData = findInitialData(html);
  if (!initialData) throw new Error(`Could not read YouTube page data for ${channel.handle}`);
  const videos = collectVideos(initialData, channel);
  if (!videos.length) throw new Error(`No public videos found for ${channel.handle}`);

  return {
    ...channel,
    subscribers: null,
    totalViews: null,
    videoCount: videos.length,
    views28d: videos.reduce((sum, video) => sum + video.views, 0),
    likes28d: null,
    watchHours28d: null,
    videos
  };
}

function parseRssEntries(xml, channel) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 30).map(([, entry]) => {
    const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] || "";
    const title = decodeXml(entry.match(/<title>([^<]+)<\/title>/)?.[1] || "Untitled video");
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    const link = decodeXml(entry.match(/<link rel="alternate" href="([^"]+)"/)?.[1] || `https://www.youtube.com/watch?v=${id}`);
    return {
      id,
      title,
      url: link,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      publishedAt: published ? published.slice(0, 10) : "Unknown",
      duration: "Short/public",
      views: null,
      viewsDelta1d: null,
      likes: null,
      likesDelta1d: null,
      status: "Public",
      topic: channel.topic,
      isPublicData: true
    };
  }).filter((video) => video.id);
}

async function fetchRssChannel(channel) {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error(`YouTube RSS returned ${response.status} for ${channel.handle}`);
  const videos = parseRssEntries(await response.text(), channel);
  if (!videos.length) throw new Error(`No RSS videos found for ${channel.handle}`);
  return {
    ...channel,
    subscribers: null,
    totalViews: null,
    videoCount: videos.length,
    views28d: null,
    likes28d: null,
    watchHours28d: null,
    videos
  };
}

async function youtubeApi(path, params) {
  const key = getYoutubeApiKey();
  if (!key) throw new Error("YOUTUBE_CHHAV_100_API_KEY is not set");
  const url = new URL(`${youtubeApiBase}/${path}`);
  for (const [name, value] of Object.entries({ ...params, key })) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, value);
  }
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `YouTube Data API returned ${response.status}`);
  }
  return data;
}

async function fetchApiChannel(channel) {
  const channelResult = await youtubeApi("channels", {
    part: "snippet,statistics,contentDetails",
    id: channel.channelId
  });
  const item = channelResult.items?.[0];
  if (!item) throw new Error(`YouTube Data API could not find ${channel.handle}`);

  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  const playlist = await youtubeApi("playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: "30"
  });
  const videoIds = playlist.items
    ?.map((entry) => entry.contentDetails?.videoId)
    .filter(Boolean) || [];
  const details = videoIds.length
    ? await youtubeApi("videos", {
        part: "snippet,statistics,contentDetails",
        id: videoIds.join(",")
      })
    : { items: [] };

  const videos = (details.items || []).map((video) => {
    const views = Number(video.statistics?.viewCount || 0);
    return {
      id: video.id,
      title: video.snippet?.title || "Untitled video",
      url: `https://www.youtube.com/watch?v=${video.id}`,
      thumbnail: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      publishedAt: video.snippet?.publishedAt ? video.snippet.publishedAt.slice(0, 10) : "Unknown",
      duration: parseIsoDuration(video.contentDetails?.duration),
      views,
      viewsDelta1d: null,
      likes: video.statistics?.likeCount === undefined ? null : Number(video.statistics.likeCount),
      likesDelta1d: null,
      status: statusForViews(views),
      topic: channel.topic,
      isPublicData: true
    };
  });

  return {
    ...channel,
    channelId: item.id,
    name: item.snippet?.title || channel.name,
    subscribers: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount || 0),
    totalViews: Number(item.statistics?.viewCount || 0),
    videoCount: Number(item.statistics?.videoCount || videos.length),
    views28d: videos.reduce((sum, video) => sum + video.views, 0),
    likes28d: videos.some((video) => video.likes !== null)
      ? videos.reduce((sum, video) => sum + (video.likes || 0), 0)
      : null,
    watchHours28d: null,
    videos
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function shortDate(date) {
  const parsed = new Date(`${date}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function applyDeltas(current, previous) {
  const previousVideos = new Map(
    previous?.channels?.flatMap((channel) => channel.videos.map((video) => [video.id, video])) || []
  );
  for (const channel of current.channels) {
    for (const video of channel.videos) {
      const old = previousVideos.get(video.id);
      video.viewsDelta1d = old ? video.views - (old.views || 0) : null;
      video.likesDelta1d = old && video.likes !== null && old.likes !== null ? video.likes - old.likes : null;
    }
  }
}

function totalsFor(report) {
  const videos = report.channels.flatMap((channel) => channel.videos);
  return {
    views: report.channels.some((channel) => channel.totalViews !== null && channel.totalViews !== undefined)
      ? report.channels.reduce((sum, channel) => sum + (channel.totalViews || 0), 0)
      : videos.reduce((sum, video) => sum + (video.views || 0), 0),
    likes: videos.some((video) => video.likes !== null)
      ? videos.reduce((sum, video) => sum + (video.likes || 0), 0)
      : null
  };
}

async function readSnapshots() {
  try {
    const files = (await readdir(snapshotsDir))
      .filter((name) => /^analytics-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .slice(-42);
    const snapshots = [];
    for (const file of files) {
      const report = await readJsonIfExists(join(snapshotsDir, file));
      if (report) snapshots.push({ date: file.slice(10, 20), report });
    }
    return snapshots;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function buildHistory(snapshots, current) {
  const byDate = new Map(snapshots.map(({ date, report }) => [date, totalsFor(report)]));
  byDate.set(todayInTokyo(), totalsFor(current));
  const daily = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, totals]) => ({
      date: shortDate(date),
      views: totals.views,
      likes: totals.likes || 0
    }));

  const weekly = [];
  for (let index = 0; index < daily.length; index += 7) {
    const chunk = daily.slice(index, index + 7);
    weekly.push({
      date: `Days ${index + 1}-${index + chunk.length}`,
      views: chunk.at(-1)?.views || 0,
      likes: chunk.at(-1)?.likes || 0
    });
  }
  return { history: daily, weeklyHistory: weekly.length ? weekly : daily };
}

async function main() {
  await mkdir(snapshotsDir, { recursive: true });
  const previous = await readJsonIfExists(latestPath);
  const useApi = Boolean(getYoutubeApiKey());
  const fetchedChannels = await Promise.all(channels.map(async (channel) => {
    if (useApi) return fetchApiChannel(channel);
    try {
      return await fetchPublicChannel(channel);
    } catch {
      return fetchRssChannel(channel);
    }
  }));
  const report = {
    updatedAt: new Date().toISOString(),
    dataSource: useApi ? "youtube-data-api-cache" : "youtube-public-rss-cache",
    privateMetricsAvailable: false,
    channels: fetchedChannels
  };
  applyDeltas(report, previous);
  Object.assign(report, buildHistory(await readSnapshots(), report));

  const date = todayInTokyo();
  await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(snapshotsDir, `analytics-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Updated ${latestPath}`);
}

main().catch(async (error) => {
  const previous = await readJsonIfExists(latestPath);
  if (previous) {
    previous.updatedAt = new Date().toISOString();
    previous.dataSource = `${previous.dataSource || "cache"}-stale`;
    previous.publicFetchError = error.message;
    await writeFile(latestPath, `${JSON.stringify(previous, null, 2)}\n`);
  }
  console.error(error.message);
  process.exit(previous ? 0 : 1);
});
