import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "public", "hearthcards");
const templateRoot = path.join(outputRoot, "templates");
const assetRoot = path.join(outputRoot, "assets");
const sourceRoot = "https://www.hearthcards.net";
const templateNames = ["minion", "spell", "weapon", "herocard", "location"];

async function download(url, destination, binary = true) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const content = binary
    ? Buffer.from(await response.arrayBuffer())
    : await response.text();
  await fs.writeFile(destination, content);
  return content;
}

function cleanAssetName(source) {
  return source.split("?")[0].replaceAll("/", path.sep);
}

function templateAssets(template) {
  const assets = new Set();
  for (const layer of template.layers ?? []) {
    if (layer.type === "static" && layer.src) assets.add(layer.src);
    if ((layer.type === "mapped" || layer.type === "classMapping") && layer.assets) {
      for (const source of Object.values(layer.assets)) assets.add(source);
    }
  }
  return assets;
}

await fs.mkdir(templateRoot, { recursive: true });
const allAssets = new Set();

for (const name of templateNames) {
  const url = `${sourceRoot}/assets_template_new/${name}.json?v=5`;
  const text = await download(url, path.join(templateRoot, `${name}.json`), false);
  const template = JSON.parse(text);
  for (const asset of templateAssets(template)) allAssets.add(asset);
}

let completed = 0;
for (const source of [...allAssets].sort()) {
  const remotePath = source.split("?")[0];
  const destination = path.join(assetRoot, cleanAssetName(source));
  await download(`${sourceRoot}/assets/${remotePath}`, destination);
  completed += 1;
  process.stdout.write(`\rHearthCards assets ${completed}/${allAssets.size}`);
}

await fs.writeFile(
  path.join(outputRoot, "source.json"),
  `${JSON.stringify({
    source: sourceRoot,
    templateVersion: 5,
    templates: templateNames,
    assets: allAssets.size,
  }, null, 2)}\n`,
);
process.stdout.write("\nTemplate sync complete.\n");
