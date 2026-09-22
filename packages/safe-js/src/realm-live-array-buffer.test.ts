import { afterEach, expect, it } from "vitest";
import { Budget } from "./interp/budget.js";
import { createRealm } from "./realm.js";
import { defineExtension, type ExtensionContext } from "./extensions.js";

const realms: ReturnType<typeof createRealm>[] = [];
afterEach(async () => {
  await Promise.all(realms.splice(0).map((realm) => realm.close()));
});
function fixture(
  options: {
    buffer?: ArrayBuffer;
    budget?: Budget;
    granted?: boolean;
    declared?: boolean;
    limit?: number;
    signal?: AbortSignal;
  } = {}
) {
  const buffer = options.buffer ?? new ArrayBuffer(8);
  const budget =
    options.budget ?? new Budget({ maxSteps: 100000, arrayLength: 1048576, dataSize: 1048576 });
  let context: ExtensionContext;
  let reference: ReturnType<ExtensionContext["createArrayBufferReference"]>;
  const extension = defineExtension({
    manifest: {
      version: 1,
      name: "live-buffer",
      globals: ["port"],
      capabilities: options.declared === false ? [] : ["array-buffer:share"]
    },
    setup(ctx) {
      context = ctx;
      return {
        globals: {
          port: ctx.createHostObject({
            properties: { buffer: { get: () => reference }, ordinary: { get: () => buffer } },
            methods: {
              expose: () => {
                reference = ctx.createArrayBufferReference(buffer);
              },
              release: () => ctx.releaseGuestReference(reference)
            }
          })
        }
      };
    }
  });
  const realm = createRealm({
    extensions: [extension],
    signal: options.signal,
    budget,
    grants: options.granted === false ? [] : ["array-buffer:share"],
    limits: options.limit ? { guestReferences: options.limit } : undefined
  });
  realms.push(realm);
  return {
    realm,
    budget,
    buffer,
    get context() {
      return context;
    },
    get reference() {
      return reference;
    }
  };
}
it("exposes stable live buffer identity and bidirectional typed-array/DataView writes", async () => {
  const test = fixture();
  expect(
    await test.realm.evaluate(
      "await port.expose();const view=new Uint8Array(port.buffer);view[0]=7;const data=new DataView(port.buffer);data.setUint16(2,258,true);return [port.buffer===port.buffer,view.buffer===port.buffer,data.buffer===port.buffer,view[0]];"
    )
  ).toMatchObject({ ok: true, returnValue: [true, true, true, 7] });
  expect([...new Uint8Array(test.buffer)]).toEqual([7, 0, 2, 1, 0, 0, 0, 0]);
  new Uint8Array(test.buffer)[0] = 9;
  expect(await test.realm.evaluate("return new Uint8Array(port.buffer)[0];")).toMatchObject({
    ok: true,
    returnValue: 9
  });
});
it("preserves default host buffer copying", async () => {
  const test = fixture();
  expect(
    await test.realm.evaluate("const view=new Uint8Array(port.ordinary);view[0]=7;return view[0];")
  ).toMatchObject({ ok: true, returnValue: 7 });
  expect(new Uint8Array(test.buffer)[0]).toBe(0);
});
it("requires both the realm grant and extension declaration", async () => {
  expect(() => fixture({ granted: false })).toThrow(/Missing grant/);
  const test = fixture({ declared: false });
  expect(
    await test.realm.evaluate("try {await port.expose();return false;}catch(e){return e.message;}")
  ).toMatchObject({ ok: true, returnValue: expect.stringContaining("array-buffer:share") });
});
it("rejects foreign references and revokes released capabilities", async () => {
  const first = fixture();
  await first.realm.evaluate("await port.expose();");
  const second = fixture();
  await second.realm.evaluate("0;");
  expect(() =>
    second.context.createHostObject({ properties: { foreign: { get: () => first.reference } } })
  ).not.toThrow();
  const foreign = defineExtension({
    manifest: { version: 1, name: "foreign", globals: ["buffer"] },
    setup() {
      return { globals: { buffer: first.reference } };
    }
  });
  const realm = createRealm({ extensions: [foreign] });
  realms.push(realm);
  await expect(realm.evaluate("return buffer.byteLength;")).rejects.toThrow(/Foreign/);
  await first.realm.evaluate("await port.release();");
  await expect(first.realm.evaluate("return port.buffer.byteLength;")).rejects.toThrow(/revoked/);
});
it("counts host-retained bytes without guest bindings and releases them on close", async () => {
  const test = fixture();
  await test.realm.evaluate("0;");
  const baseline = test.budget.currentDataSize;
  const reference = test.context.createArrayBufferReference(new ArrayBuffer(65536));
  expect(test.budget.currentDataSize - baseline).toBeGreaterThanOrEqual(65536);
  test.context.releaseGuestReference(reference);
  expect(test.budget.currentDataSize).toBe(baseline);
  test.context.createArrayBufferReference(new ArrayBuffer(65536));
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
  expect(() => test.context.createArrayBufferReference(new ArrayBuffer(1))).toThrow(/closed/);
});
it("enforces array/data quotas and reference count before publishing buffers", async () => {
  const test = fixture({ limit: 1 });
  await test.realm.evaluate("0;");
  test.context.createArrayBufferReference(new ArrayBuffer(8));
  expect(() => test.context.createArrayBufferReference(new ArrayBuffer(8))).toThrow(/limit/);
  const small = fixture({
    budget: new Budget({ maxSteps: 100000, arrayLength: 65536, dataSize: 65536 })
  });
  await small.realm.evaluate("0;");
  expect(() => small.context.createArrayBufferReference(new ArrayBuffer(65536))).toThrowError(
    expect.objectContaining({ budget: "dataSize" })
  );
  const tiny = fixture({
    budget: new Budget({ maxSteps: 100000, arrayLength: 7, dataSize: 65536 })
  });
  await tiny.realm.evaluate("0;");
  expect(() => tiny.context.createArrayBufferReference(new ArrayBuffer(8))).toThrowError(
    expect.objectContaining({ budget: "arrayLength" })
  );
});
it.each(["metadata", "symbol", "resizable", "detached", "proxy", "subclass", "shared"])(
  "rejects unsafe buffer registration %s",
  async (kind) => {
    const test = fixture();
    await test.realm.evaluate("0;");
    let buffer: unknown = new ArrayBuffer(8);
    if (kind === "metadata") Object.defineProperty(buffer, "secret", { value: () => process });
    if (kind === "symbol") Object.defineProperty(buffer, Symbol("secret"), { value: 1 });
    if (kind === "resizable") buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]);
    if (kind === "detached") structuredClone(buffer, { transfer: [buffer as ArrayBuffer] });
    if (kind === "proxy")
      buffer = new Proxy(buffer as ArrayBuffer, {
        getPrototypeOf() {
          throw new Error("proxy hook");
        }
      });
    if (kind === "subclass") buffer = new (class extends ArrayBuffer {})(8);
    if (kind === "shared") buffer = new SharedArrayBuffer(8);
    expect(() => test.context.createArrayBufferReference(buffer as ArrayBuffer)).toThrow(
      /Live buffer/
    );
  }
);
it("shares actual WASM bytes and preserves donor memory on rejected transfer", async () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const test = fixture({ buffer: memory.buffer });
  expect(
    await test.realm.evaluate(
      "await port.expose();const bytes=new Uint8Array(port.buffer);bytes[0]=42;try{structuredClone(port.buffer,{transfer:[port.buffer]});return false;}catch(e){return [bytes[0],port.buffer.byteLength];}"
    )
  ).toMatchObject({ ok: true, returnValue: [42, 65536] });
  expect(new Uint8Array(memory.buffer)[0]).toBe(42);
  const old = test.reference;
  memory.grow(1);
  expect(await test.realm.evaluate("return port.buffer.byteLength;")).toMatchObject({
    ok: true,
    returnValue: 0
  });
  const next = test.context.createArrayBufferReference(memory.buffer);
  expect(next).not.toBe(old);
});
it("connects guest typed-array writes to real WASM loads and WASM stores to guest reads", async () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const bytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 9, 2, 96, 0, 1, 127, 96, 1, 127, 0, 2, 11, 1, 3, 101, 110, 118,
    1, 109, 2, 1, 1, 2, 3, 3, 2, 0, 1, 7, 15, 2, 4, 108, 111, 97, 100, 0, 0, 4, 115, 97, 118, 101,
    0, 1, 10, 19, 2, 7, 0, 65, 0, 45, 0, 0, 11, 9, 0, 65, 0, 32, 0, 58, 0, 0, 11
  ]);
  const wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { m: memory } });
  const test = fixture({ buffer: memory.buffer });
  expect(
    await test.realm.evaluate("await port.expose();new Uint8Array(port.buffer)[0]=42;")
  ).toMatchObject({ ok: true });
  expect((wasm.exports.load as () => number)()).toBe(42);
  (wasm.exports.save as (value: number) => void)(99);
  expect(await test.realm.evaluate("return new Uint8Array(port.buffer)[0];")).toMatchObject({
    ok: true,
    returnValue: 99
  });
});
it("accounts Zoom's 20 MiB buffer and full aliases under explicit SDK quotas", async () => {
  const memory = new WebAssembly.Memory({ initial: 320, maximum: 2048 });
  const test = fixture({
    buffer: memory.buffer,
    budget: new Budget({ maxSteps: 100000, arrayLength: 33554432, dataSize: 33554432 })
  });
  await test.realm.evaluate("0;");
  expect(
    await test.realm.evaluate(
      "await port.expose(); const bytes=new Uint8Array(port.buffer); const words=new Int32Array(port.buffer); const floats=new Float64Array(port.buffer); bytes[0]=42; return [bytes.length,words.length,floats.length,words[0],bytes.buffer===words.buffer,words.buffer===floats.buffer];"
    )
  ).toMatchObject({ ok: true, returnValue: [20971520, 5242880, 2621440, 42, true, true] });
  expect(new Uint8Array(memory.buffer)[0]).toBe(42);
  expect(test.budget.currentDataSize).toBeGreaterThanOrEqual(20971520);
  expect(test.budget.currentDataSize).toBeLessThan(22020096);
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
});

it("releases live-buffer accounting on cancellation without detaching donor storage", async () => {
  const controller = new AbortController();
  const test = fixture({ signal: controller.signal });
  expect(
    await test.realm.evaluate(
      "await port.expose();const bytes=new Uint8Array(port.buffer);bytes[0]=42;"
    )
  ).toMatchObject({ ok: true });
  controller.abort();
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
  expect(test.buffer.byteLength).toBe(8);
  expect(new Uint8Array(test.buffer)[0]).toBe(42);
  expect(() => test.context.createArrayBufferReference(new ArrayBuffer(8))).toThrow();
});
