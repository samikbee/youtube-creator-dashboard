import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyGrowwSignals } from "./groww-signals.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const outputsDir = join(root, "outputs");
const distDir = join(root, "dist");

async function readJson(name) {
  return JSON.parse(await readFile(join(dataDir, name), "utf8"));
}

async function readJsonOrFallback(name, fallback) {
  try {
    return await readJson(name);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function latestGrowwReport() {
  const files = (await readdir(outputsDir))
    .filter((name) => /^groww-daily-report-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  const sourceFile = files.at(-1);
  return {
    sourceFile: sourceFile || null,
    markdown: sourceFile
      ? await readFile(join(outputsDir, sourceFile), "utf8")
      : "No Groww report file found yet."
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await cp(publicDir, distDir, { recursive: true });

  const growwHtml = await readFile(join(publicDir, "groww.html"), "utf8");
  await mkdir(join(distDir, "groww"), { recursive: true });
  await writeFile(join(distDir, "groww", "index.html"), growwHtml);

  const portfolio = await applyGrowwSignals(await readJson("latest-portfolio.json"), {
    dataDir,
    persistHighs: false
  });
  const screener = await readJsonOrFallback("latest-screener.json", {
    updatedAt: null,
    dataSource: "screener-cache-missing",
    stale: true,
    sourceUrl: "https://www.screener.in/",
    resultCount: 0,
    headers: [],
    rows: [],
    warnings: ["No Screener cache is available."]
  });

  await writeJson(join(distDir, "static-api", "groww", "portfolio.json"), portfolio);
  await writeJson(join(distDir, "static-api", "groww", "report.json"), await latestGrowwReport());
  await writeJson(join(distDir, "static-api", "groww", "screener.json"), screener);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
