const state = {
  analytics: null,
  recommendations: null,
  integrations: null,
  channelId: null,
  videoFilter: "all",
  videoSort: "views",
  growthRange: "daily"
};

const fallbackAnalytics = {
  updatedAt: "2026-06-21T08:00:00+09:00",
  channels: [
    {
      id: "zero-known",
      name: "Zero Known",
      handle: "@Zero_Known",
      url: "https://www.youtube.com/@Zero_Known",
      subscribers: 48200,
      views28d: 1824000,
      likes28d: 109300,
      videos: [
        { id: "zk-001", title: "The Viking Treasure Nobody Came Back For", publishedAt: "2026-06-18", views: 286400, viewsDelta1d: 31800, likes: 18420, likesDelta1d: 2140, status: "Rising", topic: "World Mystery" },
        { id: "zk-002", title: "The 8,000-Year-Old Skeleton in a Cave", publishedAt: "2026-06-15", views: 153900, viewsDelta1d: 9200, likes: 9310, likesDelta1d: 540, status: "Stable", topic: "World Mystery" },
        { id: "zk-003", title: "The Map That Should Not Know Antarctica", publishedAt: "2026-06-12", views: 512800, viewsDelta1d: 68400, likes: 32650, likesDelta1d: 4050, status: "Breakout", topic: "World Mystery" }
      ]
    },
    {
      id: "mittimic",
      name: "MittiMic",
      handle: "@MittiMic",
      url: "https://www.youtube.com/@MittiMic",
      subscribers: 19700,
      views28d: 642000,
      likes28d: 32700,
      videos: [
        { id: "mm-001", title: "Why AI Browsers Matter", publishedAt: "2026-06-17", views: 84800, viewsDelta1d: 7400, likes: 4210, likesDelta1d: 360, status: "Stable", topic: "AI News" },
        { id: "mm-002", title: "The New Siri AI Explained Fast", publishedAt: "2026-06-10", views: 129600, viewsDelta1d: 18600, likes: 6150, likesDelta1d: 870, status: "Rising", topic: "AI News" }
      ]
    }
  ],
  history: [
    { date: "Jun 15", views: 91000, likes: 5100 },
    { date: "Jun 16", views: 112000, likes: 6900 },
    { date: "Jun 17", views: 128000, likes: 7400 },
    { date: "Jun 18", views: 193000, likes: 12100 },
    { date: "Jun 19", views: 221000, likes: 13900 },
    { date: "Jun 20", views: 204000, likes: 12700 },
    { date: "Jun 21", views: 238000, likes: 15100 }
  ],
  weeklyHistory: [
    { date: "Week 20", views: 612000, likes: 34200 },
    { date: "Week 21", views: 738000, likes: 41900 },
    { date: "Week 22", views: 864000, likes: 52600 },
    { date: "Week 23", views: 1114000, likes: 67300 },
    { date: "Week 24", views: 1297000, likes: 79200 },
    { date: "Week 25", views: 1491000, likes: 91300 }
  ]
};

const fallbackRecommendations = {
  date: "2026-06-21",
  mystery: [
    { number: 1, title: "Short-format mystery sources only", "30_second_hook_angle": "The next report should avoid long compilations and use one-mystery posts, Shorts, Reels, or specific news items.", links: [] },
    { number: 2, title: "Viking treasure nobody came back for", "30_second_hook_angle": "Someone buried a fortune 1,000 years ago and never returned.", links: [{ label: "Live Science", url: "https://www.livescience.com/archaeology/vikings/the-detectors-never-stopped-beeping-nearly-3-000-coins-discovered-in-field-are-norways-largest-viking-hoard-on-record" }] }
  ],
  ai: [
    { number: 1, title: "AI news feed placeholder", short_summary: "Connect the recommendation job to refresh daily AI news and high-performing AI videos.", links: [] }
  ]
};

const fallbackIntegrations = {
  youtubeDataApi: false,
  recommendationProvider: "static-demo"
};

const format = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const fullFormat = new Intl.NumberFormat("en-US");

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

function allVideos() {
  return state.analytics.channels.flatMap((channel) =>
    channel.videos.map((video) => ({ ...video, channelName: channel.name, channelId: channel.id }))
  );
}

function selectedChannel() {
  if (state.channelId === "all") {
    const videos = allVideos();
    const knownSubscribers = state.analytics.channels.filter((channel) => channel.subscribers !== null && channel.subscribers !== undefined);
    const knownTotalViews = state.analytics.channels.filter((channel) => channel.totalViews !== null && channel.totalViews !== undefined);
    const knownVideoCounts = state.analytics.channels.filter((channel) => channel.videoCount !== null && channel.videoCount !== undefined);
    return {
      id: "all",
      name: "All channels",
      subscribers: knownSubscribers.length
        ? knownSubscribers.reduce((sum, channel) => sum + channel.subscribers, 0)
        : null,
      totalViews: knownTotalViews.length
        ? knownTotalViews.reduce((sum, channel) => sum + channel.totalViews, 0)
        : null,
      videoCount: knownVideoCounts.length
        ? knownVideoCounts.reduce((sum, channel) => sum + channel.videoCount, 0)
        : videos.length,
      views28d: state.analytics.channels.reduce((sum, channel) => sum + channel.views28d, 0),
      likes28d: state.analytics.channels.reduce((sum, channel) => sum + (channel.likes28d || 0), 0),
      videos
    };
  }
  return state.analytics.channels.find((channel) => channel.id === state.channelId) || state.analytics.channels[0];
}

function numberCell(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return fullFormat.format(value);
}

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function thumbnailFor(video) {
  return video.thumbnail || (video.id && !video.id.includes("-") ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : "");
}

function videoAgeDays(video) {
  const parsed = Date.parse(video.publishedAt);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function durationSeconds(value = "") {
  const parts = String(value).split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function youtubeVideoId(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    return "";
  }
  return "";
}

function sourceName(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function ideaImageFor(item) {
  const directImage = item.thumbnail || item.image || item.image_url || item.og_image || item.source_image;
  if (directImage) return { src: directImage, label: "Source image", type: "image" };

  const link = linkFor(item);
  const videoId = link && youtubeVideoId(link.url);
  if (videoId) {
    return {
      src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      label: "YouTube thumbnail",
      type: "video"
    };
  }
  if (link?.url) {
    return {
      src: `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(link.url)}`,
      label: sourceName(link.url),
      type: "article"
    };
  }
  return null;
}

function signedNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Snapshot needed";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fullFormat.format(value)}`;
}

function percentChange(current, previous) {
  if (!previous) return "0%";
  const value = ((current - previous) / previous) * 100;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function growthPoints() {
  return state.growthRange === "weekly"
    ? state.analytics.weeklyHistory || state.analytics.history
    : state.analytics.history;
}

function sumVideos(videos, key) {
  return videos.reduce((sum, video) => sum + (Number(video[key]) || 0), 0);
}

function hasAnyMetric(videos, key) {
  return videos.some((video) => video[key] !== null && video[key] !== undefined);
}

function sumOrUnavailable(videos, key) {
  return hasAnyMetric(videos, key) ? sumVideos(videos, key) : null;
}

function averageVideos(videos, key) {
  const known = videos.filter((video) => video[key] !== null && video[key] !== undefined);
  if (!known.length) return null;
  return Math.round(sumVideos(known, key) / known.length);
}

function linkFor(item) {
  return item.links?.find((link) => link.url.includes("youtube.com")) || item.links?.[0];
}

function summarize(item) {
  return item["30_second_hook_angle"] || item.short_summary || item.why_it_matters || item.why_it_is_trending_or_likely_to_perform || "";
}

function titleCoaching(video) {
  const title = video.title || "";
  if (/#\w+/.test(title)) return "Move hashtags out of the title and use a curiosity-led title instead.";
  if (title.length < 32) return "Make the title more specific: add the mystery, conflict, or surprising payoff.";
  if (!/[0-9]/.test(title) && video.topic === "World Mystery") return "Test a title with a number or scale, such as a date, count, age, or distance.";
  return "Keep the strongest searchable words at the start of the title.";
}

function packagingCoaching(video) {
  const views = Number(video.views) || 0;
  const age = videoAgeDays(video);
  const seconds = durationSeconds(video.duration);
  if (views < 25 && age !== null && age <= 3) return "Early traction is low. Change thumbnail/title within 24 hours and repost a stronger hook as a Short.";
  if (views >= 1000 || video.status === "Rising" || video.status === "Breakout") return "This has a signal. Make a follow-up with the same promise, but a bigger twist.";
  if (seconds !== null && seconds <= 45) return "For Shorts, show the payoff or visual proof in the first 1-2 seconds.";
  return "Improve the first 5 seconds: start with the most surprising line before any explanation.";
}

function engagementCoaching(video) {
  const views = Number(video.views) || 0;
  const likes = video.likes === null || video.likes === undefined ? null : Number(video.likes);
  if (!views || likes === null) return "Ask one simple comment question to create visible engagement.";
  const likeRate = likes / views;
  if (likeRate >= 0.06) return "Like rate is promising. Pin a comment asking viewers what part to investigate next.";
  if (likeRate <= 0.015) return "The idea may be interesting, but the emotional payoff needs to be clearer.";
  return "Add a pinned comment with a direct question and one related source/link.";
}

function videoCritique(video) {
  return [
    packagingCoaching(video),
    titleCoaching(video),
    engagementCoaching(video)
  ];
}

function channelCoach(channel) {
  const videos = [...channel.videos].sort((a, b) => (b.views || 0) - (a.views || 0));
  const topVideo = videos[0];
  const latestVideo = [...channel.videos].sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt))[0];
  const views = videos.map((video) => Number(video.views) || 0);
  const averageViews = views.length ? Math.round(views.reduce((sum, value) => sum + value, 0) / views.length) : 0;
  const isMystery = channel.id === "zero-known" || channel.handle === "@Zero_Known";
  const isAi = channel.id === "mittimic" || channel.handle === "@MittiMic";

  if (isMystery) {
    return {
      must: topVideo
        ? `Make one follow-up to "${topVideo.title}" with a stronger opening question and a clearer visual proof.`
        : "Publish one focused mystery Short with the reveal shown in the first two seconds.",
      good: latestVideo && (latestVideo.views || 0) < Math.max(10, averageViews)
        ? `Repackage the latest upload "${latestVideo.title}" with a sharper title and thumbnail.`
        : "Create a mini-series format: Part 1 asks the mystery, Part 2 reveals the strongest evidence.",
      focus: "World mystery growth"
    };
  }

  if (isAi) {
    return {
      must: "Pick one AI news item today and explain it in plain language with one practical use case.",
      good: topVideo
        ? `Turn the strongest topic "${topVideo.title}" into a shorter, clearer version with a better first line.`
        : "Make one 30-second AI explainer using a direct before/after example.",
      focus: "AI channel growth"
    };
  }

  return {
    must: "Publish one video that repeats the clearest winning topic from this channel.",
    good: "Update one older video title/thumbnail and compare results tomorrow.",
    focus: "Channel growth"
  };
}

function renderChannels() {
  const box = document.querySelector("#channelButtons");
  box.className = "channel-buttons";
  const buttons = [
    { id: "all", name: "All channels" },
    ...state.analytics.channels
  ];
  box.innerHTML = buttons.map((channel) => `
    <button class="channel-button ${channel.id === state.channelId ? "active" : ""}" data-channel="${channel.id}">
      ${channel.name}${channel.handle ? `<span>${channel.handle}</span>` : ""}
    </button>
  `).join("");

  box.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.channelId = button.dataset.channel;
      render();
    });
  });
}

function renderKpis() {
  const channel = selectedChannel();
  const videos = channel.videos;
  const totalViewsKnown = sumOrUnavailable(videos, "views");
  const totalLikes = sumOrUnavailable(videos, "likes");
  const viewsDelta = sumOrUnavailable(videos, "viewsDelta1d");
  const likesDelta = sumOrUnavailable(videos, "likesDelta1d");
  document.querySelector("#kpiGrid").innerHTML = [
    ["Channel lifetime views", channel.totalViews === null || channel.totalViews === undefined ? "API needed" : format.format(channel.totalViews)],
    ["Loaded video views", totalViewsKnown === null ? "API needed" : format.format(totalViewsKnown)],
    ["Loaded video likes", totalLikes === null ? "API needed" : format.format(totalLikes)],
    ["Subscribers", channel.subscribers === null ? "API needed" : format.format(channel.subscribers)],
    ["Published videos", channel.videoCount === null || channel.videoCount === undefined ? videos.length : format.format(channel.videoCount)],
    ["Views change 1 day", signedNumber(viewsDelta)],
    ["Likes change 1 day", signedNumber(likesDelta)],
    ["Loaded videos", format.format(videos.length)]
  ].map(([label, value]) => `
    <article class="kpi">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function drawChart() {
  const canvas = document.querySelector("#trendChart");
  const ctx = canvas.getContext("2d");
  const points = growthPoints().filter((point) => point && (point.views !== null || point.likes !== null));
  const width = canvas.width;
  const height = canvas.height;
  const pad = 42;
  if (!points.length) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#5f6368";
    ctx.font = "22px system-ui";
    ctx.fillText("No movement data yet. Run the daily refresh to create the first snapshot.", pad, height / 2);
    return;
  }
  const maxViews = Math.max(1, ...points.map((point) => point.views || 0));
  const maxLikes = Math.max(1, ...points.map((point) => point.likes || 0));

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#dadce0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, height - pad);
  ctx.lineTo(width - pad, height - pad);
  ctx.stroke();

  function plot(key, max, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((point[key] || 0) / max) * (height - pad * 2);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (points.length === 1) {
      const point = points[0];
      const y = height - pad - ((point[key] || 0) / max) * (height - pad * 2);
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
    }
    ctx.stroke();
    points.forEach((point, index) => {
      const x = points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((point[key] || 0) / max) * (height - pad * 2);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
    });
  }

  plot("views", maxViews, "#1a73e8");
  plot("likes", maxLikes, "#188038");

  ctx.fillStyle = "#5f6368";
  ctx.font = "22px system-ui";
  points.forEach((point, index) => {
    const x = points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2);
    ctx.fillText(point.date, x - 26, height - 12);
  });
  if (points.length === 1) {
    ctx.font = "18px system-ui";
    ctx.fillText("Only one snapshot so far. Tomorrow's refresh will show the real 7-day line.", pad, pad - 14);
  }
}

function renderGrowth() {
  const points = growthPoints();
  const latest = points.at(-1);
  const previous = points.at(-2) || latest;
  const first = points[0] || latest;
  const viewsDelta = latest.views - previous.views;
  const likesDelta = latest.likes - previous.likes;
  const viewsWindowDelta = latest.views - first.views;
  const likesWindowDelta = latest.likes - first.likes;
  const rangeLabel = state.growthRange === "weekly" ? "Weekly growth" : "Daily growth";

  document.querySelector("#growthRangeLabel").textContent = rangeLabel;
  document.querySelector("#growthSummary").innerHTML = [
    ["Latest views increase", `${signedNumber(viewsDelta)} (${percentChange(latest.views, previous.views)})`, viewsDelta],
    ["Latest likes increase", `${signedNumber(likesDelta)} (${percentChange(latest.likes, previous.likes)})`, likesDelta],
    ["Range views increase", signedNumber(viewsWindowDelta), viewsWindowDelta],
    ["Range likes increase", signedNumber(likesWindowDelta), likesWindowDelta]
  ].map(([label, value, delta]) => `
    <article class="growth-card">
      <span>${label}</span>
      <strong class="${delta >= 0 ? "delta-up" : "delta-down"}">${value}</strong>
    </article>
  `).join("");

  document.querySelector("#growthRows").innerHTML = points.map((point, index) => {
    const previousPoint = points[index - 1];
    const viewChange = previousPoint ? point.views - previousPoint.views : 0;
    const likeChange = previousPoint ? point.likes - previousPoint.likes : 0;
    return `
      <tr>
        <td><strong>${point.date}</strong></td>
        <td>${numberCell(point.views)}</td>
        <td class="${viewChange >= 0 ? "delta-up" : "delta-down"}">${index ? signedNumber(viewChange) : "-"}</td>
        <td>${numberCell(point.likes)}</td>
        <td class="${likeChange >= 0 ? "delta-up" : "delta-down"}">${index ? signedNumber(likeChange) : "-"}</td>
      </tr>
    `;
  }).join("");
}

function renderVideos() {
  let videos = allVideos();
  if (state.channelId && state.channelId !== "all") videos = videos.filter((video) => video.channelId === state.channelId);
  if (state.videoFilter !== "all") videos = videos.filter((video) => video.topic === state.videoFilter);
  videos.sort((a, b) => {
    if (state.videoSort === "recent") return dateValue(b.publishedAt) - dateValue(a.publishedAt);
    return (b.views || 0) - (a.views || 0);
  });

  document.querySelector("#videoRows").innerHTML = videos.map((video) => `
    <tr>
      <td>
        <div class="video-title-cell">
          ${thumbnailFor(video) ? `<img class="video-thumb" src="${thumbnailFor(video)}" alt="">` : `<div class="video-thumb placeholder">YT</div>`}
          <div class="video-info">
            <strong>${video.url ? `<a href="${video.url}" target="_blank" rel="noreferrer">${video.title}</a>` : video.title}</strong>
            <span class="muted">${video.channelName} · ${video.publishedAt}</span>
          </div>
        </div>
      </td>
      <td>${video.duration || "-"}</td>
      <td>${numberCell(video.views)}</td>
      <td><span class="${video.viewsDelta1d >= 0 ? "delta-up" : "delta-down"}">${signedNumber(video.viewsDelta1d)}</span></td>
      <td>${numberCell(video.likes)}<br><span class="${video.likesDelta1d >= 0 ? "delta-up" : "delta-down"}">${signedNumber(video.likesDelta1d)}</span></td>
      <td>
        <ul class="critique-list">
          ${videoCritique(video).map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </td>
      <td><span class="pill ${video.status.toLowerCase()}">${video.status}</span></td>
    </tr>
  `).join("");
}

function renderChannelCoach() {
  document.querySelector("#channelCoachCards").innerHTML = state.analytics.channels.map((channel) => {
    const advice = channelCoach(channel);
    return `
      <article class="coach-card">
        <div class="coach-card-header">
          <div>
            <p>${advice.focus}</p>
            <h4>${channel.name}</h4>
            <span>${channel.handle || ""}</span>
          </div>
          <span class="pill">Today</span>
        </div>
        <div class="coach-action must">
          <strong>Must do</strong>
          <p>${advice.must}</p>
        </div>
        <div class="coach-action good">
          <strong>Good to do</strong>
          <p>${advice.good}</p>
        </div>
      </article>
    `;
  }).join("");
}

function renderIdeaList(selector, items, limit) {
  document.querySelector(selector).innerHTML = items.slice(0, limit).map((item) => {
    const link = linkFor(item);
    const image = ideaImageFor(item);
    return `
      <article class="idea-card">
        <div class="idea-card-body">
          ${image ? `<img class="idea-thumb ${image.type}" src="${image.src}" alt="${image.label}">` : `<div class="idea-thumb placeholder">Idea</div>`}
          <div>
            <h4>${item.number}. ${item.title}</h4>
            <p>${summarize(item)}</p>
            ${link ? `<a href="${link.url}" target="_blank" rel="noreferrer">Open source · ${sourceName(link.url)}</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderRecommendations() {
  document.querySelector("#reportDate").textContent = state.recommendations.date
    ? `Daily report · ${state.recommendations.date}`
    : "Daily report";
  const recommendationStamp = state.recommendations.updatedAt
    ? `Recommendation file: ${state.recommendations.sourceFile || "latest report"}`
    : "No daily recommendation file found yet";
  document.querySelector("#recommendationsUpdatedAt").textContent = recommendationStamp;
  document.querySelector("#aiUpdatedAt").textContent = recommendationStamp;
  renderIdeaList("#mysteryIdeas", state.recommendations.mystery, 9);
  renderIdeaList("#aiNews", state.recommendations.ai, 10);

  const best = state.recommendations.mystery[0];
  const bestLink = best && linkFor(best);
  document.querySelector("#bestIdea").innerHTML = best ? `
    <div class="idea-card">
      <div class="idea-card-body featured">
        ${ideaImageFor(best) ? `<img class="idea-thumb ${ideaImageFor(best).type}" src="${ideaImageFor(best).src}" alt="${ideaImageFor(best).label}">` : `<div class="idea-thumb placeholder">Idea</div>`}
        <div>
          <h4>${best.title}</h4>
          <p>${summarize(best)}</p>
          ${bestLink ? `<a href="${bestLink.url}" target="_blank" rel="noreferrer">Review source · ${sourceName(bestLink.url)}</a>` : ""}
        </div>
      </div>
    </div>
  ` : "<p>No report found yet.</p>";
}

function renderIntegrations() {
  const items = [
    ["YouTube Data API", state.integrations.youtubeDataApi ? "Configured" : "Needs API key"],
    ["Analytics source", state.integrations.analyticsProvider || "local cache"],
    ["Recommendations", state.integrations.recommendationProvider]
  ];
  document.querySelector("#integrationStatus").innerHTML = items.map(([name, status]) => `
    <div class="status-card">
      <strong>${name}</strong>
      <span class="pill">${status}</span>
    </div>
  `).join("");
}

function render() {
  document.querySelector("#todayLabel").textContent = new Date().toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo"
  });
  document.querySelector("#analyticsUpdatedAt").textContent = `Analytics cache updated ${new Date(state.analytics.updatedAt).toLocaleString()}`;
  document.querySelector("#dataNotice").textContent =
    state.analytics.dataSource === "youtube-data-api-cache"
      ? "Showing cached public YouTube Data API results from local files."
      : state.analytics.dataSource === "youtube-public-rss-cache"
        ? "Showing real latest uploads from YouTube RSS. Add a YouTube Data API key for public view, like, and subscriber counts."
      : state.analytics.dataSource === "youtube-public-cache"
        ? "Showing cached public YouTube page results from local files."
        : state.analytics.dataSource?.includes("stale")
          ? `Showing the last saved analytics cache because today's public refresh had an issue: ${state.analytics.publicFetchError || "unknown error"}`
        : state.analytics.publicFetchError
          ? `Showing sample/local data because the analytics cache is not ready: ${state.analytics.publicFetchError}`
          : "Showing the local analytics cache. Run the daily refresh to update public YouTube metrics.";
  renderChannels();
  renderKpis();
  drawChart();
  renderGrowth();
  renderChannelCoach();
  renderVideos();
  renderRecommendations();
  renderIntegrations();
}

async function refresh() {
  const button = document.querySelector("#refreshButton");
  button.textContent = "Refreshing";
  try {
    [state.analytics, state.recommendations, state.integrations] = await Promise.all([
      getJson("/api/analytics"),
      getJson("/api/refresh"),
      getJson("/api/integrations")
    ]);
  } catch {
    state.analytics = fallbackAnalytics;
    state.recommendations = fallbackRecommendations;
    state.integrations = fallbackIntegrations;
  }
  state.channelId ||= "all";
  render();
  button.textContent = "Refresh";
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.videoFilter = button.dataset.filter;
    renderVideos();
  });
});

document.querySelectorAll(".sort-segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".sort-segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.videoSort = button.dataset.sort;
    renderVideos();
  });
});

document.querySelectorAll(".range-segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range-segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.growthRange = button.dataset.range;
    drawChart();
    renderGrowth();
  });
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector("#pageTitle").textContent = button.textContent;
    const target = document.querySelector(`#${button.dataset.target}`);
    if (target) {
      window.scrollTo({
        top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 18),
        behavior: "auto"
      });
    }
  });
});

document.querySelector("#refreshButton").addEventListener("click", refresh);
refresh().catch((error) => {
  document.body.innerHTML = `<main class="error"><h1>Could not load dashboard</h1><p>${error.message}</p></main>`;
});
