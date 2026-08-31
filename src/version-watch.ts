const VERSION_CHECK_INTERVAL_MS = 30_000;

function bundlePathFromDocument(documentRoot: Document) {
  const source = documentRoot.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  )?.src;
  return source ? new URL(source, window.location.origin).pathname : null;
}

async function latestBundlePath(signal: AbortSignal) {
  const response = await fetch(new URL("/", window.location.origin), {
    cache: "no-store",
    headers: { Accept: "text/html" },
    signal,
  });
  if (!response.ok) return null;

  const html = await response.text();
  const nextDocument = new DOMParser().parseFromString(html, "text/html");
  return bundlePathFromDocument(nextDocument);
}

export function watchForAppUpdates() {
  const loadedBundle = bundlePathFromDocument(document);
  if (!loadedBundle) return () => undefined;

  const controller = new AbortController();
  let checking = false;

  const check = async () => {
    if (checking || document.visibilityState !== "visible") return;
    checking = true;
    try {
      const availableBundle = await latestBundlePath(controller.signal);
      if (availableBundle && availableBundle !== loadedBundle) {
        window.location.reload();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("无法检查页面更新", error);
      }
    } finally {
      checking = false;
    }
  };

  const checkWhenVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  const timer = window.setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS);
  window.addEventListener("focus", checkWhenVisible);
  document.addEventListener("visibilitychange", checkWhenVisible);

  return () => {
    controller.abort();
    window.clearInterval(timer);
    window.removeEventListener("focus", checkWhenVisible);
    document.removeEventListener("visibilitychange", checkWhenVisible);
  };
}
