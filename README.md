# Project: YouTube Intelligence System

## Context

- User: Senior Product Manager focusing on AI and business strategy.
- User is not a technical engineer and is recently very interested in AI.
- Explain important steps in plain, layman language first.
- When using technical terms such as sandbox, API, cache, server, deployment, or environment variable, briefly explain what the term means and why it matters.
- Goal: Build a local daily command center that shows refreshed content recommendations and public YouTube analytics from precomputed local files.

## Rules & Constraints

- Always use Pragmatic personality mode: concise, task-focused, direct.
- Never hardcode API keys or secrets into scripts. Always read from `.env.local`.
- If an automated process or shell command fails, document the fix in a local log file so we do not repeat the mistake.
- Test locally before pushing. Do not push every small AI-generated change to GitHub because each push can trigger a Vercel deployment.
- Only push to the main GitHub branch after a major feature is complete and verified locally.
- Avoid making website page requests call slow YouTube or research workflows directly. Use local Codex automation to fetch/process data, save it to files, then let the website read the precomputed files.
- Keep Vercel environment variables in sync with local `.env.local`; secrets are not committed to GitHub.

## AI Agent Traps

### Vercel Deployment Ceiling

- Trap: Vercel Hobby can hit a daily deployment/build ceiling if Codex commits and pushes every tiny fix.
- Rule: Run and verify changes locally first. Push only after a feature is complete.
- Local target: use the local app URL before deployment.

### Serverless Timeout

- Trap: Vercel Hobby serverless functions can time out on slow API-heavy jobs.
- Rule: Do not run heavy YouTube collection, comment fetching, sorting, or analysis directly inside Vercel request handlers.
- Preferred pattern: local automation pulls YouTube data, writes cached JSON/Excel files, and the deployed dashboard reads those files quickly.

### Missing Environment Variables

- Trap: `.env.local` is intentionally ignored by Git, so Vercel will not receive local secrets automatically.
- Rule: Add required keys manually in Vercel Dashboard > Settings > Environment Variables.
- Required today: `YOUTUBE_CHHAV_100_API_KEY`.

## Current App

A local dashboard for YouTube channel analytics and daily content recommendations. The dashboard is local-first and reads saved files from this workspace.

## What It Does Now

- Shows the two configured channels in one page: Zero Known and MittiMic.
- Displays public video-level performance: views, likes when available, status, duration, publish date, and topic.
- Uses public YouTube data only; private YouTube Studio metrics are intentionally out of scope.
- Loads the latest daily recommendation report from `outputs/daily-report-YYYY-MM-DD.md`.
- Separates world mystery ideas from AI news.
- Reads cached analytics from `data/latest-analytics.json`.
- Keeps daily analytics snapshots in `data/snapshots/analytics-YYYY-MM-DD.json`.
- Provides local endpoints for analytics, recommendations, refresh, debug, and integration status.
- Does not send email, create videos, generate scripts, or upload to Google Drive/SharePoint.

## Run Locally

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Set YouTube API Key

Create a private `.env.local` file in this project folder:

```text
YOUTUBE_CHHAV_100_API_KEY=your_youtube_data_api_key_here
```

This API key is for the dashboard's Google Cloud project. It is not a login for one specific YouTube account. The old name `YOUTUBE_API_KEY` still works as a backup, but `YOUTUBE_CHHAV_100_API_KEY` is clearer.

Then restart the server. Check:

```text
http://localhost:4173/api/debug
```

If the key is working after `npm run refresh:analytics`, `dataSource` should show `youtube-data-api-cache`.

## Refresh Analytics

Run this to update the local public YouTube analytics cache:

```bash
npm run refresh:analytics
```

The refresh writes:

```text
data/latest-analytics.json
data/snapshots/analytics-YYYY-MM-DD.json
```

The website reads those files when opened or refreshed. Daily automation should run this command before you check the dashboard.

## API Plan

The app is structured so the mock layer can be replaced with real providers:

- YouTube channel/video metadata: YouTube Data API.
- YouTube performance analytics: daily local public-metric cache only.
- Daily recommendations: scheduled Codex automation stored as markdown files in `outputs/`.

Environment variables reserved for the next phase:

```text
YOUTUBE_CHHAV_100_API_KEY=
RECOMMENDATION_PROVIDER=
```

## Git / Web Deployment

Yes, this can be put into GitHub and deployed so every saved change updates the live web app. Good next options:

- Vercel for fast preview deployments.
- Render or Railway if the backend needs scheduled jobs.
- Google Cloud Run if you want everything close to YouTube/Google APIs.

## Deployment Flow

```text
Local App -> push code -> GitHub Repository -> trigger deploy -> Vercel App
```

Operational rule: only push to GitHub after local testing is complete, because each push can trigger a Vercel build.
