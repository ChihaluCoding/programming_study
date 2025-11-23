// Detect when we need to stream videos from a CDN when running on GitHub Pages.
const VIDEO_PATH_PREFIX = computeVideoPathPrefix();

function computeVideoPathPrefix() {
  if (typeof window === "undefined") {
    return "";
  }

  const override = window.__VIDEO_PATH_PREFIX__;
  if (typeof override === "string" && override.trim()) {
    return ensureTrailingSlash(override.trim());
  }

  const hostMatch = window.location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!hostMatch) {
    return "";
  }

  const account = hostMatch[1];
  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  const repository = pathSegments[0] || `${account}.github.io`;
  const base = `https://cdn.jsdelivr.net/gh/${account}/${repository}@main/`;
  return ensureTrailingSlash(base);
}

function ensureTrailingSlash(value) {
  if (!value) {
    return "";
  }
  return value.endsWith("/") ? value : `${value}/`;
}

const elements = {
  categoryList: document.getElementById("categoryList"),
  tree: document.getElementById("tree"),
  player: document.getElementById("player"),
  playerTitle: document.getElementById("videoTitle"),
  playerBreadcrumb: document.getElementById("videoBreadcrumb"),
  playerMeta: document.getElementById("videoMeta"),
  playerCard: document.getElementById("playerCard"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  progressCount: document.getElementById("progressCount"),
};

const state = {
  categories: [],
  selectedCategoryIndex: -1,
  selectedVideo: null,
  openPaths: new Set(),
  completedVideos: new Set(),
  totalVideos: 0,
  validVideoPaths: new Set(),
};

init();

async function init() {
  loadCompletedVideos();
  try {
    const response = await fetch("data/videos.json");
    if (!response.ok) {
      throw new Error(`動画データの取得に失敗しました (HTTP ${response.status})`);
    }
    const payload = await response.json();
    state.categories = payload.categories ?? [];
    const stats = collectVideoStats(state.categories);
    state.totalVideos = stats.total;
    state.validVideoPaths = stats.paths;
    pruneCompletedVideos();
    updateProgressUI();

    if (state.categories.length === 0) {
      renderTreeEmpty("動画カテゴリが見つかりませんでした。");
    } else {
      selectCategory(0);
    }
  } catch (error) {
    console.error(error);
    renderTreeEmpty(
      "動画データの読み込みに失敗しました。ページを再読み込みしてください。",
    );
  }
}

function renderTreeEmpty(message) {
  elements.tree.innerHTML = `<div class="tree-empty"><p>${message}</p></div>`;
}

function renderCategoryList() {
  const list = elements.categoryList;
  list.innerHTML = "";

  const fragment = document.createDocumentFragment();
  state.categories.forEach((category, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-item${
      index === state.selectedCategoryIndex ? " is-active" : ""
    }`;
    button.innerHTML = `<span>${category.name}</span><span>${category.videoCount ?? 0}本</span>`;
    button.addEventListener("click", () => {
      selectCategory(index);
    });
    li.appendChild(button);
    fragment.appendChild(li);
  });

  list.appendChild(fragment);
}

function selectCategory(index) {
  if (index < 0 || index >= state.categories.length) {
    return;
  }

  const category = state.categories[index];
  const selection = findFirstVideo(category, [category.name], []);

  const openSet = new Set();
  if (selection?.directories) {
    selection.directories.forEach((dirPath) => {
      if (dirPath) {
        openSet.add(dirPath);
      }
    });
  }

  state.selectedCategoryIndex = index;
  state.selectedVideo = selection;
  state.openPaths = openSet;

  renderCategoryList();
  renderTree();
  updatePlayer();
}

function renderTree() {
  const category = state.categories[state.selectedCategoryIndex];
  if (!category) {
    renderTreeEmpty("カテゴリを選択してください。");
    return;
  }

  const container = document.createElement("div");
  const heading = document.createElement("div");
  heading.className = "tree-heading";

  const title = document.createElement("h3");
  title.textContent = category.name;
  const count = document.createElement("span");
  count.textContent = `${category.videoCount ?? 0}本の動画`;

  heading.append(title, count);
  container.appendChild(heading);

  if (!Array.isArray(category.children) || category.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.innerHTML = "<p>このカテゴリには動画が登録されていません。</p>";
    container.appendChild(empty);
  } else {
    category.children.forEach((child) => {
      if (child.type === "directory") {
        const group = createDirectoryGroup(
          child,
          [category.name, child.name],
          0,
          [],
        );
        container.appendChild(group);
      } else if (child.type === "video") {
        container.appendChild(createVideoLeaf(child, [category.name], []));
      }
    });
  }

  elements.tree.innerHTML = "";
  elements.tree.appendChild(container);
}

function createDirectoryGroup(node, breadcrumbs, depth, directoryPaths) {
  const details = document.createElement("details");
  details.className = "tree-group";
  details.dataset.path = node.path;

  const dirSet = state.openPaths ?? new Set();
  details.open = depth < 1 || dirSet.has(node.path);

  details.addEventListener("toggle", () => {
    if (!node.path) {
      return;
    }
    if (details.open) {
      state.openPaths.add(node.path);
    } else {
      state.openPaths.delete(node.path);
    }
  });

  const summary = document.createElement("summary");
  summary.textContent = node.name;
  summary.setAttribute("data-count", node.videoCount ?? 0);
  details.appendChild(summary);

  const nextDirectoryPaths = [...directoryPaths, node.path];
  (node.children ?? []).forEach((child) => {
    if (child.type === "directory") {
      const group = createDirectoryGroup(
        child,
        [...breadcrumbs, child.name],
        depth + 1,
        nextDirectoryPaths,
      );
      details.appendChild(group);
    } else if (child.type === "video") {
      const leaf = createVideoLeaf(child, breadcrumbs, nextDirectoryPaths);
      details.appendChild(leaf);
    }
  });

  return details;
}

function createVideoLeaf(videoNode, breadcrumbs, directoryPaths) {
  const leaf = document.createElement("div");
  leaf.className = "video-leaf";
  leaf.dataset.path = videoNode.path;

  if (state.completedVideos.has(videoNode.path)) {
    leaf.classList.add("is-complete");
  }

  const checkboxContainer = document.createElement("label");
  checkboxContainer.className = "video-check";
  checkboxContainer.title = "学習済みにチェック";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.completedVideos.has(videoNode.path);
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  checkbox.addEventListener("change", () => {
    toggleVideoCompletion(videoNode.path, checkbox.checked);
  });

  const checkmark = document.createElement("span");
  checkmark.className = "video-check__box";

  checkboxContainer.append(checkbox, checkmark);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "video-button";
  button.textContent = videoNode.name.replace(/\.mp4$/i, "");

  if (state.selectedVideo?.node?.path === videoNode.path) {
    button.classList.add("is-playing");
  }

  button.addEventListener("click", () => {
    const selection = {
      node: videoNode,
      breadcrumbs: [...breadcrumbs, videoNode.name],
      directories: directoryPaths,
    };
    applyVideoSelection(selection, { focusPlayer: true });
  });

  const size = document.createElement("span");
  size.className = "video-duration";
  size.textContent = formatBytes(videoNode.size);

  leaf.append(checkboxContainer, button, size);
  return leaf;
}

function applyVideoSelection(selection, { focusPlayer = false } = {}) {
  if (!selection) {
    return;
  }

  if (!state.openPaths) {
    state.openPaths = new Set();
  }

  (selection.directories ?? []).forEach((dirPath) => {
    if (dirPath) {
      state.openPaths.add(dirPath);
    }
  });

  state.selectedVideo = selection;
  renderTree();
  updatePlayer();

  if (focusPlayer) {
    focusVideoPlayer();
  }
}

function updatePlayer() {
  const selection = state.selectedVideo;

  if (!selection) {
    elements.playerTitle.textContent = "動画を選択してください";
    elements.playerBreadcrumb.textContent = "";
    elements.playerMeta.textContent = "";
    elements.player.removeAttribute("src");
    elements.player.load();
    return;
  }

  elements.playerTitle.textContent = selection.node.name.replace(/\.mp4$/i, "");
  const breadcrumbText =
    selection.breadcrumbs.slice(0, -1).join(" › ") || "カテゴリ未選択";
  elements.playerBreadcrumb.textContent = breadcrumbText;
  elements.playerMeta.textContent = `ファイルサイズ: ${formatBytes(selection.node.size)}`;

  const newSrc = resolveVideoSrc(selection.node.path);
  if (elements.player.getAttribute("src") !== newSrc) {
    elements.player.src = newSrc;
  }
  elements.player.load();
}

function focusVideoPlayer() {
  elements.playerCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function findFirstVideo(node, breadcrumbs, directoryPaths) {
  if (!node) {
    return null;
  }

  if (node.type === "video") {
    return {
      node,
      breadcrumbs,
      directories: directoryPaths,
    };
  }

  for (const child of node.children ?? []) {
    if (child.type === "directory") {
      const result = findFirstVideo(
        child,
        [...breadcrumbs, child.name],
        [...directoryPaths, child.path],
      );
      if (result) {
        return result;
      }
    } else if (child.type === "video") {
      return {
        node: child,
        breadcrumbs: [...breadcrumbs, child.name],
        directories: directoryPaths,
      };
    }
  }

  return null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function resolveVideoSrc(originalPath) {
  if (!originalPath) {
    return "";
  }

  const encodedPath = originalPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (originalPath.startsWith("videos/")) {
    return `${VIDEO_PATH_PREFIX}${encodedPath}`;
  }

  return encodedPath;
}

function loadCompletedVideos() {
  try {
    const raw = localStorage.getItem("learning:completedVideos");
    if (!raw) {
      state.completedVideos = new Set();
      return;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.completedVideos = new Set(parsed);
    } else {
      state.completedVideos = new Set();
    }
  } catch (error) {
    console.warn("完了状態の読み込みに失敗しました:", error);
    state.completedVideos = new Set();
  }
}

function persistCompletedVideos() {
  try {
    const serialized = JSON.stringify(Array.from(state.completedVideos));
    localStorage.setItem("learning:completedVideos", serialized);
  } catch (error) {
    console.warn("完了状態の保存に失敗しました:", error);
  }
}

function toggleVideoCompletion(path, isCompleted) {
  if (!path) {
    return;
  }

  if (!state.validVideoPaths.has(path)) {
    return;
  }

  if (isCompleted) {
    state.completedVideos.add(path);
  } else {
    state.completedVideos.delete(path);
  }

  persistCompletedVideos();
  updateProgressUI();

  const leaf = findLeafElement(path);
  if (leaf) {
    leaf.classList.toggle("is-complete", isCompleted);
  }
}

function findLeafElement(path) {
  if (!path) {
    return null;
  }
  const safePath = path.replace(/"/g, '\\"');
  return elements.tree.querySelector(`[data-path="${safePath}"]`);
}

function collectVideoStats(categories) {
  const paths = new Set();
  let total = 0;

  const visit = (node) => {
    if (!node) {
      return;
    }
    if (node.type === "video") {
      total += 1;
      if (node.path) {
        paths.add(node.path);
      }
      return;
    }
    (node.children ?? []).forEach((child) => visit(child));
  };

  categories.forEach((category) => visit(category));
  return { total, paths };
}

function pruneCompletedVideos() {
  const filtered = [...state.completedVideos].filter((path) =>
    state.validVideoPaths.has(path),
  );
  if (filtered.length !== state.completedVideos.size) {
    state.completedVideos = new Set(filtered);
    persistCompletedVideos();
  }
}

function updateProgressUI() {
  const total = state.totalVideos || 0;
  const completed = Math.min(state.completedVideos.size, total);
  const percent = total === 0 ? 0 : (completed / total) * 100;
  const percentText = total === 0 ? "0%" : `${percent.toFixed(1)}%`;

  if (elements.progressFill) {
    elements.progressFill.style.width = `${percent}%`;
  }
  if (elements.progressText) {
    elements.progressText.textContent = percentText;
  }
  if (elements.progressCount) {
    elements.progressCount.textContent = `${completed} / ${total} 本`;
  }
}
