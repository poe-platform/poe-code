import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { withResources } from "./index.js";

const limits = { maxInputBytes: 1024, maxDecodedBytes: 1024, maxRetainedBytes: 1024, maxWork: 4096, maxResources: 8 };
const options = () => ({ limits, signal: new AbortController().signal });

test("cross-realm byte views preserve only their view bytes and close once", async () => {
  const bytes = runInNewContext("new Uint8Array([9, 0, 255, 8]).subarray(1, 3)") as Uint8Array;
  let closed = 0;
  await withResources({ ...options(), vfs: async () => ({
    chunks: (async function* () { yield bytes; })(), close: async () => { closed++; },
  }) }, async resources => {
    const result = await resources.load("vfs:/x");
    assert.deepEqual(result, Uint8Array.of(0, 255));
    assert.equal(resources.usage.decodedBytes, 2);
    assert.equal(resources.usage.retainedBytes, 2);
    bytes.fill(7);
    assert.deepEqual(result, Uint8Array.of(0, 255));
  });
  assert.equal(closed, 1);
});

test("shadowed byte metadata and iteration cannot bypass byte limits or change copied bytes", async () => {
  const bytes = Uint8Array.of(0, 255);
  Object.defineProperty(bytes, "byteLength", { value: 0 });
  Object.defineProperty(bytes, Symbol.iterator, { value: function* () { yield 42; } });
  for (const maxDecodedBytes of [1, 2]) {
    let closed = 0;
    await withResources({ ...options(), limits: { ...limits, maxDecodedBytes }, vfs: async () => ({
      chunks: (async function* () { yield bytes; })(), close: async () => { closed++; },
    }) }, async resources => {
      if (maxDecodedBytes === 1) {
        await assert.rejects(resources.load("vfs:/x"), { code: "LIMIT_EXCEEDED" });
        assert.equal(resources.usage.retainedBytes, 0);
      } else {
        assert.deepEqual(await resources.load("vfs:/x"), Uint8Array.of(0, 255));
        assert.equal(resources.usage.decodedBytes, 2);
      }
    });
    assert.equal(closed, 1);
  }
});

test("forged byte tags, proxies and other views are rejected before decoded allocation", async () => {
  for (const bytes of [
    { [Symbol.toStringTag]: "Uint8Array", byteLength: 2, 0: 0, 1: 255 },
    new Proxy(Uint8Array.of(1), {}), new Uint8ClampedArray(1), new DataView(new ArrayBuffer(1)),
  ]) {
    let closed = 0;
    await withResources({ ...options(), vfs: async () => ({
      chunks: (async function* () { yield bytes as Uint8Array; })(), close: async () => { closed++; },
    }) }, async resources => {
      await assert.rejects(resources.load("vfs:/x"), { code: "INVALID_VALUE" });
      assert.equal(resources.usage.decodedBytes, 0);
      assert.equal(resources.usage.retainedBytes, 0);
    });
    assert.equal(closed, 1);
  }
});

test("data URLs decode bytes without form decoding or ambient access", async () => {
  await withResources(options(), async resources => {
    assert.deepEqual(await resources.load("data:,a+%00%FF"), Uint8Array.of(97, 43, 0, 255));
    assert.deepEqual(await resources.load("data:application/octet-stream;base64,AP8="), Uint8Array.of(0, 255));
    assert.equal(resources.usage.decodedBytes, 6);
    assert.equal(resources.usage.retainedBytes, 6);
  });
});

test("malformed data and noncanonical base64 fail before retaining bytes", async () => {
  for (const url of ["data:,a%", "data:,é", "data:;base64,Af==", "data:;base64,A===", "data:;base64,AA", "data:;base64,AA?="]) {
    await withResources(options(), async resources => {
      await assert.rejects(resources.load(url), { code: "INVALID_VALUE" });
      assert.equal(resources.usage.retainedBytes, 0);
    });
  }
});

test("ambient files, fonts and network are denied by default", async () => {
  await withResources(options(), async resources => {
    for (const url of ["file:///etc/passwd", "https://example.test/a", "../font.ttf"]) {
      await assert.rejects(resources.load(url), { code: "UNSUPPORTED_CAPABILITY" });
    }
    await assert.rejects(resources.font("Arial"), { code: "UNSUPPORTED_CAPABILITY" });
  });
});

test("bounded VFS and supplied fonts use explicit capabilities and own copied bytes", async () => {
  let closed = 0;
  const bytes = Uint8Array.of(1, 2);
  const open = async () => ({ chunks: (async function* () { yield bytes; })(), close: async () => { closed++; } });
  await withResources({ ...options(), vfs: open, fonts: open }, async resources => {
    const result = await resources.load("vfs:/input");
    bytes[0] = 9;
    assert.deepEqual(result, Uint8Array.of(1, 2));
    assert.deepEqual(await resources.font("supplied"), bytes);
  });
  assert.equal(closed, 2);
});

test("retained and decoded limits reject streams and always close the lease", async () => {
  for (const key of ["maxDecodedBytes", "maxRetainedBytes", "maxWork"]) {
    let closed = 0;
    // Two reference scans (12 units) and the first next() (1) fit;
    // copying the two-byte chunk must exceed the work boundary.
    await withResources({ ...options(), limits: { ...limits, [key]: key === "maxWork" ? 13 : 1 }, vfs: async () => ({
      chunks: (async function* () { yield Uint8Array.of(1, 2); })(), close: async () => { closed++; },
    }) }, async resources => {
      await assert.rejects(resources.load("vfs:/x"), { code: "LIMIT_EXCEEDED" });
    });
    assert.equal(closed, 1);
  }
});

test("data budgets admit exact byte boundaries and reject before allocation", async () => {
  await withResources({ ...options(), limits: { ...limits, maxInputBytes: 9, maxDecodedBytes: 1, maxRetainedBytes: 1 } }, async resources => {
    assert.deepEqual(await resources.load("data:,%FF"), Uint8Array.of(255));
    assert.equal(resources.usage.inputBytes, 9);
    await assert.rejects(resources.load("data:,a"), { code: "LIMIT_EXCEEDED" });
  });
  for (const key of ["maxInputBytes", "maxDecodedBytes", "maxRetainedBytes", "maxWork"]) {
    await withResources({ ...options(), limits: { ...limits, [key]: 1 } }, async resources => {
      await assert.rejects(resources.load("data:,ab"), { code: "LIMIT_EXCEEDED" });
    });
  }
  await withResources({ ...options(), limits: { ...limits, maxResources: 1 } }, async resources => {
    await resources.load("data:,");
    await assert.rejects(resources.load("data:,"), { code: "LIMIT_EXCEEDED" });
  });
});

test("cleanup failures surface without replacing primary falsey errors", async () => {
  const cleanup = new Error("close failed");
  const vfs = async () => ({ chunks: (async function* () { yield Uint8Array.of(1); })(), close: async () => { throw cleanup; } });
  await assert.rejects(withResources({ ...options(), vfs }, resources => resources.load("vfs:/x")), error => error === cleanup);
  const controller = new AbortController();
  await assert.rejects(withResources({ ...options(), signal: controller.signal, vfs: async () => {
    controller.abort(0);
    return vfs();
  } }, resources => resources.load("vfs:/x")), error => error === 0);
});

test("scope termination cancels an unawaited stalled read and releases it", async () => {
  let closed = 0;
  await assert.rejects(withResources({ ...options(), vfs: async () => ({
    chunks: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
    close: async () => { closed++; },
  }) }, async resources => {
    void resources.load("vfs:/x");
  }), { code: "INVALID_VALUE" });
  assert.equal(closed, 1);
});

test("cancellation interrupts a stalled stream and preserves falsey reason", async () => {
  const controller = new AbortController();
  let closed = 0;
  await assert.rejects(withResources({ ...options(), signal: controller.signal, vfs: async () => ({
    chunks: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
    close: async () => { closed++; },
  }) }, async resources => {
    const pending = resources.load("vfs:/x");
    queueMicrotask(() => controller.abort(false));
    await assert.rejects(pending, reason => reason === false);
  }), reason => reason === false);
  assert.equal(closed, 1);
});

test("authorized network is explicit and invocation APIs expire on cleanup", async () => {
  let expired: Parameters<Parameters<typeof withResources>[1]>[0] | undefined;
  const urls: string[] = [];
  await withResources({ ...options(), network: async (url) => {
    urls.push(url);
    return { chunks: (async function* () { yield Uint8Array.of(4); })(), close: async () => {} };
  } }, async resources => {
    expired = resources;
    assert.deepEqual(await resources.load("https://example.test/a"), Uint8Array.of(4));
  });
  assert.deepEqual(urls, ["https://example.test/a"]);
  await assert.rejects(expired!.load("data:,a"), { code: "INVALID_VALUE" });
  assert.equal(expired!.usage.retainedBytes, 0);
});

test("relative resources resolve against explicit VFS bases without host paths", async () => {
  const references: string[] = [];
  await withResources({ ...options(), vfs: async reference => {
    references.push(reference);
    return { chunks: (async function* () { yield Uint8Array.of(1); })(), close: async () => {} };
  } }, async resources => {
    await resources.load("../images/a.png", "vfs:/docs/page.html");
    await resources.load("#fragment", "vfs:/docs/page.html");
    await assert.rejects(resources.load("../a", "file:///etc/page.html"), { code: "UNSUPPORTED_CAPABILITY" });
  });
  assert.deepEqual(references, ["vfs:/images/a.png", "vfs:/docs/page.html"]);
});

test("explicit cancellation before entry never acquires a capability", async () => {
  const controller = new AbortController();
  controller.abort("");
  let entered = false;
  await assert.rejects(withResources({ ...options(), signal: controller.signal }, async () => { entered = true; }), error => error === "");
  assert.equal(entered, false);
});

test("failed lease cleanup releases unreturned output accounting", async () => {
  await withResources({ ...options(), vfs: async () => ({
    chunks: (async function* () { yield Uint8Array.of(1, 2); })(),
    close: async () => { throw new Error("close failed"); },
  }) }, async resources => {
    await assert.rejects(resources.load("vfs:/x"), /close failed/);
    assert.equal(resources.usage.retainedBytes, 0);
    assert.equal(resources.usage.decodedBytes, 2);
  });
});

test("stream assembly bounds peak retained copies and zero-byte algorithm work", async () => {
  let closed = 0;
  await withResources({ ...options(), limits: { ...limits, maxRetainedBytes: 3 }, vfs: async () => ({
    chunks: (async function* () { yield Uint8Array.of(1, 2); })(), close: async () => { closed++; },
  }) }, async resources => {
    await assert.rejects(resources.load("vfs:/x"), { code: "LIMIT_EXCEEDED" });
    assert.equal(resources.usage.retainedBytes, 0);
  });
  await withResources({ ...options(), limits: { ...limits, maxWork: 16 }, vfs: async () => ({
    chunks: (async function* () { for (;;) yield new Uint8Array(); })(), close: async () => { closed++; },
  }) }, async resources => {
    await assert.rejects(resources.load("vfs:/x"), { code: "LIMIT_EXCEEDED" });
    assert.equal(resources.usage.retainedBytes, 0);
  });
  assert.equal(closed, 2);
});

test("URL fragments are not fetched or decoded as resource bytes", async () => {
  await withResources(options(), async resources => {
    assert.deepEqual(await resources.load("data:,a#fragment"), Uint8Array.of(97));
    assert.deepEqual(await resources.load("data:,a%23b"), Uint8Array.of(97, 35, 98));
    assert.deepEqual(await resources.load("data:;base64,AA==#fragment"), Uint8Array.of(0));
  });
});

test("cancellation during successful lease cleanup rejects the read and releases output", async () => {
  const controller = new AbortController();
  let closed = 0;
  await assert.rejects(withResources({ ...options(), signal: controller.signal, vfs: async () => ({
    chunks: (async function* () { yield Uint8Array.of(1, 2); })(),
    close: async () => { closed++; controller.abort(false); },
  }) }, async resources => {
    await assert.rejects(resources.load("vfs:/x"), reason => reason === false);
    assert.equal(resources.usage.retainedBytes, 0);
    assert.equal(resources.usage.decodedBytes, 2);
  }), reason => reason === false);
  assert.equal(closed, 1);
});

test("producer reuse of Buffer chunks cannot mutate retained resource bytes", async () => {
  const chunk = Buffer.from([1, 2]);
  await withResources({ ...options(), vfs: async () => ({
    chunks: (async function* () {
      yield chunk;
      chunk.set([3, 4]);
      yield chunk;
      chunk.fill(9);
    })(),
    close: async () => { chunk.fill(8); },
  }) }, async resources => {
    assert.deepEqual(await resources.load("vfs:/x"), Uint8Array.of(1, 2, 3, 4));
  });
});
