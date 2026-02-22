const CORS_PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
];

let activeProxyIndex = 0;

/**
 * Wrap a URL with CORS proxy if needed.
 */
export function corsProxy(url: string): string {
  return `${CORS_PROXIES[activeProxyIndex]}${encodeURIComponent(url)}`;
}

/**
 * Fetch with optional CORS proxy.
 * Falls back to the next proxy if the first one fails.
 */
export async function corsFetch(
  url: string,
  needsCors: boolean
): Promise<Response> {
  if (!needsCors) {
    return fetch(url);
  }

  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyIndex = (activeProxyIndex + i) % CORS_PROXIES.length;
    const proxiedUrl = `${CORS_PROXIES[proxyIndex]}${encodeURIComponent(url)}`;

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
