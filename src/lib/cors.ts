interface CorsProxyConfig {
  /** Base URL prefix — the target URL is appended after this. */
  prefix: string;
  /** Whether the target URL should be encoded with encodeURIComponent. */
  encode: boolean;
}

const CORS_PROXIES: CorsProxyConfig[] = [
  { prefix: "https://proxy.corsfix.com/?", encode: false },
  { prefix: "https://whateverorigin.org/get?url=", encode: true },
  { prefix: "https://corsproxy.io/?url=", encode: true },
  { prefix: "https://api.allorigins.win/raw?url=", encode: true },
];

let activeProxyIndex = 0;

/**
 * Build a proxied URL from a proxy config and a target URL.
 */
function buildProxiedUrl(proxy: CorsProxyConfig, url: string): string {
  return `${proxy.prefix}${proxy.encode ? encodeURIComponent(url) : url}`;
}

/**
 * Wrap a URL with the active CORS proxy.
 */
export function corsProxy(url: string): string {
  return buildProxiedUrl(CORS_PROXIES[activeProxyIndex], url);
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

  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyIndex = (activeProxyIndex + i) % CORS_PROXIES.length;
    const proxiedUrl = buildProxiedUrl(CORS_PROXIES[proxyIndex], url);

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
