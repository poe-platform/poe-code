import { expect, it } from "vitest";
import { createResourceIO } from "./index.js";

const filesystem = { async read() { return []; }, async write() {} };

it("classifies a malformed redirect as invalid URI without admitting another request", async () => {
  const events: string[] = [];
  const io = createResourceIO({ cwd: "/", filesystem, transport: {
    redirects: 2,
    async authorize(uri) { events.push(`authorize ${uri}`); },
    async request(uri) { events.push(`request ${uri}`); return { redirect: "https://[" }; }
  } });
  await expect(io.read("https://public.test/a", new AbortController().signal))
    .rejects.toMatchObject({ name: "SsconvertError", code: "invalid-request", exitCode: 1 });
  expect(events).toEqual(["authorize https://public.test/a", "request https://public.test/a"]);
});

it("never requests an unauthorized redirect and propagates the exact host denial", async () => {
  const denial = { policyDenied: true };
  const events: string[] = [];
  const io = createResourceIO({ cwd: "/", filesystem, transport: {
    redirects: 2,
    async authorize(uri) {
      events.push(`authorize ${uri}`);
      if (uri.startsWith("https://private.test/")) throw denial;
    },
    async request(uri) { events.push(`request ${uri}`); return { redirect: "https://private.test/data" }; }
  } });
  await expect(io.read("https://public.test/a", new AbortController().signal)).rejects.toBe(denial);
  expect(events).toEqual([
    "authorize https://public.test/a", "request https://public.test/a", "authorize https://private.test/data"
  ]);
});

it("does not consult inherited adapter names or inherited descriptor bindings", async () => {
  let inheritedReads = 0;
  const adapter = { async read() { inheritedReads++; return []; }, async write() {} };
  const io = createResourceIO({ cwd: "/", filesystem,
    adapters: Object.create({ https: adapter }),
    descriptors: Object.create({ 0: { source: [new Uint8Array([7])] } })
  });
  const signal = new AbortController().signal;
  await expect(io.read("https://private.test/a", signal)).rejects.toMatchObject({ code: "capability-denied" });
  await expect(io.read("fd://0", signal)).rejects.toMatchObject({ code: "io" });
  expect(inheritedReads).toBe(0);
});

it("stops before host requests when authorization cancels the invocation", async () => {
  const controller = new AbortController();
  const reason = { stage: "authorize" };
  let requests = 0;
  const io = createResourceIO({ cwd: "/", filesystem, transport: {
    redirects: 0,
    async authorize() { controller.abort(reason); },
    async request() { requests++; return {}; }
  } });
  await expect(io.read("https://public.test/a", controller.signal)).rejects.toBe(reason);
  expect(requests).toBe(0);
});

it("retains the configured request capability across asynchronous authorization", async () => {
  const events: string[] = [];
  const transport = {
    redirects: 0,
    async authorize() {
      events.push("authorize original");
      transport.request = async () => { events.push("request replacement"); return {}; };
    },
    async request() { events.push("request original"); return {}; }
  };
  const io = createResourceIO({ cwd: "/", filesystem, transport });
  await io.read("https://public.test/a", new AbortController().signal);
  expect(events).toEqual(["authorize original", "request original"]);
});

it("retains the admitted redirect bound when the request mutates its host configuration", async () => {
  let requests = 0;
  const transport = {
    redirects: 0,
    async authorize() {},
    async request() { requests++; transport.redirects = 10; return { redirect: "/next" }; }
  };
  const io = createResourceIO({ cwd: "/", filesystem, transport });
  await expect(io.read("https://public.test/a", new AbortController().signal))
    .rejects.toMatchObject({ code: "resource-limit" });
  expect(requests).toBe(1);
});

it("authorizes write direction before exposing binary output to a transport", async () => {
  const denial = { noWrites: true };
  let requests = 0;
  const io = createResourceIO({ cwd: "/", filesystem, transport: {
    redirects: 0,
    async authorize(uri, direction) {
      expect(uri).toBe("https://public.test/a");
      expect(direction).toBe("write");
      throw denial;
    },
    async request() { requests++; return {}; }
  } });
  await expect(io.write("https://public.test/a", new Uint8Array([0, 255]), new AbortController().signal))
    .rejects.toBe(denial);
  expect(requests).toBe(0);
});

it("awaits owned adapter iterator cleanup after an early consumer stop", async () => {
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => { release = resolve; });
  let closing = false;
  let closed = false;
  const io = createResourceIO({ cwd: "/", filesystem, adapters: { blob: {
    async read() { return (async function* () {
      try { yield new Uint8Array([0, 255]); }
      finally { closing = true; await cleanup; closed = true; }
    })(); },
    async write() {}
  } } });
  let settled = false;
  const consumption = (async () => {
    for await (const bytes of await io.read("blob:binary", new AbortController().signal)) {
      expect([...bytes]).toEqual([0, 255]);
      break;
    }
  })().finally(() => { settled = true; });
  for (let turns = 0; turns < 12 && !closing; turns++) await Promise.resolve();
  expect(closing).toBe(true);
  expect(settled).toBe(false);
  expect(closed).toBe(false);
  release();
  await consumption;
  expect(closed).toBe(true);
});
