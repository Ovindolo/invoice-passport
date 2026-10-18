/**
 * Optional private transport over the Anyone network (https://anyone.io): requests leave through
 * a local Anyone client's SOCKS5 port, so the invoice host, the RPC provider or the facilitator do
 * not see the agent's IP address. "socks5h" makes the proxy resolve host names too, so DNS does not
 * leak either. Start a client with `npx @anyone-protocol/anyone-client` (SOCKS port 9050).
 * Deno only (Deno.createHttpClient); in other runtimes pass a SOCKS-capable fetch yourself.
 */

export const ANYONE_SOCKS_URL = "socks5h://127.0.0.1:9050";

/** A fetch that sends every request through the SOCKS5 proxy of a local Anyone client. */
export function anyoneFetch(proxyUrl: string = ANYONE_SOCKS_URL): typeof fetch {
  if (!/^socks5h?:\/\//.test(proxyUrl)) throw new Error(`Not a SOCKS5 URL: ${proxyUrl}`);
  const client = Deno.createHttpClient({ proxy: { url: proxyUrl } });
  return ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, client })) as typeof fetch;
}

/** True when something listens on the proxy's host and port (the Anyone client is running). */
export async function anyoneReachable(proxyUrl: string = ANYONE_SOCKS_URL): Promise<boolean> {
  const { hostname, port } = new URL(proxyUrl.replace(/^socks5h?:/, "http:"));
  try {
    const conn = await Deno.connect({ hostname, port: Number(port || 9050) });
    conn.close();
    return true;
  } catch {
    return false;
  }
}
