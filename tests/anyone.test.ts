import { anyoneFetch, anyoneReachable } from "../src/anyone.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

/** A minimal SOCKS5 proxy (no auth, CONNECT only) that records the destinations it was asked for. */
function socksProxy() {
  const seen: string[] = [];
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const conns: Deno.Conn[] = [];
  const read = async (conn: Deno.Conn, n: number) => {
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const r = await conn.read(out.subarray(got));
      if (r === null) throw new Error("closed");
      got += r;
    }
    return out;
  };
  (async () => {
    for await (const conn of listener) {
      conns.push(conn);
      (async () => {
        const [, nMethods] = await read(conn, 2);
        await read(conn, nMethods);
        await conn.write(new Uint8Array([5, 0]));
        const [, , , atyp] = await read(conn, 4);
        let host: string;
        if (atyp === 3) host = new TextDecoder().decode(await read(conn, (await read(conn, 1))[0]));
        else if (atyp === 1) host = [...await read(conn, 4)].join(".");
        else throw new Error(`atyp ${atyp}`);
        const portBytes = await read(conn, 2);
        const port = (portBytes[0] << 8) | portBytes[1];
        seen.push(`${atyp === 3 ? "name" : "ip"}:${host}:${port}`);
        const upstream = await Deno.connect({ hostname: host === "localhost" ? "127.0.0.1" : host, port });
        conns.push(upstream);
        await conn.write(new Uint8Array([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        await Promise.allSettled([conn.readable.pipeTo(upstream.writable), upstream.readable.pipeTo(conn.writable)]);
      })().catch(() => {});
    }
  })().catch(() => {});
  const { port } = listener.addr as Deno.NetAddr;
  return {
    url: `socks5h://127.0.0.1:${port}`,
    seen,
    close: () => {
      listener.close();
      for (const c of conns) {
        try {
          c.close();
        } catch { /* already closed */ }
      }
    },
  };
}

Deno.test({
  name: "anyoneFetch sends requests through the SOCKS proxy and lets it resolve the host name",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, () => new Response("passport"));
    const { port } = server.addr as Deno.NetAddr;
    const proxy = socksProxy();
    try {
      assert(await anyoneReachable(proxy.url), "proxy reachable");
      const res = await anyoneFetch(proxy.url)(`http://localhost:${port}/passport`);
      assert(await res.text() === "passport", "body");
      // socks5h: the proxy got the name, not an address resolved on this machine
      assert(proxy.seen.includes(`name:localhost:${port}`), JSON.stringify(proxy.seen));
    } finally {
      proxy.close();
      await server.shutdown();
    }
  },
});

Deno.test("anyoneReachable is false when no client listens, and anyoneFetch rejects non-SOCKS URLs", async () => {
  assert(!(await anyoneReachable("socks5h://127.0.0.1:1")));
  let threw = false;
  try {
    anyoneFetch("http://127.0.0.1:8080");
  } catch {
    threw = true;
  }
  assert(threw);
});
