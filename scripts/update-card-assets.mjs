import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceUrl = process.env.HEARTHSTONE_CARDS_URL ||
  "https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json";
const archiveDir = process.argv[2] || process.env.HEARTHSTONE_ASSET_DIR;
const cacheDir = path.resolve(process.argv[3] || path.join(rootDir, "card-images"));

if (!archiveDir) {
  console.error(
    "用法: node scripts/update-card-assets.mjs <素材归档目录> [运行时图片缓存目录]",
  );
  process.exit(1);
}

const resolvedArchiveDir = path.resolve(archiveDir);
const sourcePath = path.join(resolvedArchiveDir, "cards.collectible.zhCN.json");
const archiveImageDir = path.join(resolvedArchiveDir, "images");
fs.mkdirSync(resolvedArchiveDir, { recursive: true });

const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`下载最新卡牌 JSON 失败: HTTP ${response.status}`);
const source = await response.text();
const cards = JSON.parse(source);
if (!Array.isArray(cards) || cards.length < 1_000) {
  throw new Error("最新卡牌 JSON 内容异常");
}

fs.writeFileSync(sourcePath, source, "utf8");
const metadata = {
  sourceUrl,
  downloadedAt: new Date().toISOString(),
  lastModified: response.headers.get("last-modified"),
  etag: response.headers.get("etag"),
  sourceRecords: cards.length,
};

const result = spawnSync(process.execPath, [
  path.join(rootDir, "scripts", "build-card-catalog.mjs"),
  sourcePath,
  path.join(rootDir, "collectible_cards_zhCN.full.json"),
  archiveImageDir,
  cacheDir,
], { cwd: rootDir, encoding: "utf8", stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

metadata.catalogRecords = JSON.parse(
  fs.readFileSync(path.join(rootDir, "collectible_cards_zhCN.full.json"), "utf8"),
).length;
const serializedMetadata = `${JSON.stringify(metadata, null, 2)}\n`;
fs.writeFileSync(path.join(resolvedArchiveDir, "metadata.json"), serializedMetadata, "utf8");
fs.writeFileSync(
  path.join(rootDir, "collectible_cards_zhCN.metadata.json"),
  serializedMetadata,
  "utf8",
);
