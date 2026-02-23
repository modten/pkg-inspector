import { loadSettings } from "./settings";

interface CorsProxyConfig {
  /** Base URL prefix — the target URL is appended after this. */
  prefix: string;
  /** Whether the target URL should be encoded with encodeURIComponent. */
  encode: boolean;
}

const BUILTIN_CORS_PROXIES: CorsProxyConfig[] = [
  { prefix: "https://pkg-inspector-cors-proxy.vercel.app?url=", encode: false },
  // { prefix: "https://proxy.corsfix.com/?", encode: false },
  // { prefix: "https://whateverorigin.org/get?url=", encode: true },
  // { prefix: "https://corsproxy.io/?url=", encode: true },
  // { prefix: "https://api.allorigins.win/raw?url=", encode: true },
];

let activeProxyIndex = 0;

/**
 * Build a proxied URL from a proxy config and a target URL.
 */
function buildProxiedUrl(proxy: CorsProxyConfig, url: string): string {
  return `${proxy.prefix}${proxy.encode ? encodeURIComponent(url) : url}`;
}

/**
 * Build the full proxy list: custom proxy (if set) first, then built-in ones.
 */
function getProxyList(): CorsProxyConfig[] {
  const settings = loadSettings();
  const custom = settings.corsProxyUrl?.trim();
  if (custom) {
    // Custom proxy is prepended — it gets tried first.
    // We assume custom proxies take the target URL appended directly (no encoding).
    return [
      { prefix: custom, encode: false },
      ...BUILTIN_CORS_PROXIES,
    ];
  }
  return BUILTIN_CORS_PROXIES;
}

/**
 * Wrap a URL with the active CORS proxy.
 */
export function corsProxy(url: string): string {
  const proxies = getProxyList();
  const idx = activeProxyIndex % proxies.length;
  return buildProxiedUrl(proxies[idx], url);
}

/**
 * Fetch with optional CORS proxy.
 * Falls back to the next proxy if the first one fails.
 */
export async function corsFetch(
  url: string,
  needsCors: boolean,
): Promise<Response> {
  if (!needsCors) {
    return fetch(url);
  }

  const proxies = getProxyList();

  for (let i = 0; i < proxies.length; i++) {
    const proxyIndex = (activeProxyIndex + i) % proxies.length;
    const proxiedUrl = buildProxiedUrl(proxies[proxyIndex], url);

    try {
      const res = await fetch(proxiedUrl);
      if (res.ok) {
        activeProxyIndex = proxyIndex;
        return res;
      }
    } catch {
      // Try next proxy
    }
  }

  throw new Error(`All CORS proxies failed for: ${url}`);
}
