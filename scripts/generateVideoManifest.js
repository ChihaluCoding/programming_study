import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(".");
const videosDir = path.join(repoRoot, "videos");
const outputFile = path.join(repoRoot, "site", "data", "videos.json");
const collator = new Intl.Collator("ja-JP-u-nu-latn", {
  numeric: true,
  sensitivity: "base",
});

async function ensureVideosDir() {
  try {
    const stats = await fs.stat(videosDir);
    if (!stats.isDirectory()) {
      throw new Error(`'videos' is not a directory: ${videosDir}`);
    }
  } catch (error) {
    throw new Error(`videosディレクトリが見つかりません: ${error.message}`);
  }
}

function getLeadingNumberWeight(name) {
  if (!name) {
    return Number.POSITIVE_INFINITY;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return Number.POSITIVE_INFINITY;
  }
  const firstCode = trimmed.codePointAt(0);
  if (firstCode >= 0x2460 && firstCode <= 0x2473) {
    return firstCode - 0x245f;
  }
  const match = trimmed.match(/^(\d+)/);
  if (match) {
    return Number(match[1]);
  }
  return Number.POSITIVE_INFINITY;
}

function compareEntries(a, b) {
  const weightDiff =
    getLeadingNumberWeight(a.name) - getLeadingNumberWeight(b.name);
  if (weightDiff !== 0) {
    return weightDiff;
  }
  return collator.compare(a.name, b.name);
}

async function buildNode(fullPath) {
  const stats = await fs.stat(fullPath);
  const relative = path.relative(videosDir, fullPath);
  const normalized = relative.split(path.sep).join("/");

  if (stats.isDirectory()) {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const childPath = path.join(fullPath, entry.name);

      const childNode = await buildNode(childPath);
      if (childNode) {
        children.push(childNode);
      }
    }

    children.sort(compareEntries);

    const videoCount = children.reduce(
      (total, child) => total + (child.videoCount ?? 0),
      0,
    );

    return {
      type: "directory",
      name: path.basename(fullPath),
      path: normalized ? `videos/${normalized}` : "videos",
      videoCount,
      children,
    };
  }

  if (stats.isFile() && path.extname(fullPath).toLowerCase() === ".mp4") {
    return {
      type: "video",
      name: path.basename(fullPath),
      path: normalized ? `videos/${normalized}` : "videos",
      size: stats.size,
      videoCount: 1,
    };
  }

  return null;
}

async function main() {
  await ensureVideosDir();
  const rootNode = await buildNode(videosDir);
  if (!rootNode) {
    throw new Error("動画データを構築できませんでした。");
  }

  const categories = rootNode.children ?? [];
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(
    outputFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), categories }, null, 2),
    "utf8",
  );

  console.log(
    `動画メタデータを生成しました: ${outputFile} (カテゴリ数: ${categories.length})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
