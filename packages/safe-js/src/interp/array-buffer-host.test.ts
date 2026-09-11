import { expect, it } from "vitest";
import { run } from "../run.js";
import { declareHostOperation } from "./host-bridge.js";
import { digestHostCallArguments } from "./host-call.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";

it("distinguishes buffer byte contents in host-call digests", () => {
  const first = new ArrayBuffer(4);
  const second = new ArrayBuffer(4);
  new Uint8Array(second)[0] = 7;
  expect(digestHostCallArguments([first])).not.toBe(digestHostCallArguments([second]));
  expect(digestHostCallArguments([first])).toBe(digestHostCallArguments([new ArrayBuffer(4)]));
});

it("distinguishes fixed and resizable capacity in host-call digests", () => {
  const fixed = new ArrayBuffer(8);
  const resizable = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 8 }]) as ArrayBuffer;
  const larger = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer;
  expect(digestHostCallArguments([fixed])).not.toBe(digestHostCallArguments([resizable]));
  expect(digestHostCallArguments([resizable])).not.toBe(digestHostCallArguments([larger]));
});

it("distinguishes backing capacity and tracking layout when only a view is passed", async () => {
  const sources = [
    "return new Float32Array(new ArrayBuffer(8))",
    "return new Float32Array(new ArrayBuffer(8,{maxByteLength:16}))",
    "return new Float32Array(new ArrayBuffer(8,{maxByteLength:16}),0,2)",
    "return new Float32Array(new ArrayBuffer(8,{maxByteLength:24}))",
    "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,4,2);buffer.resize(0);return view",
    "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,8,1);buffer.resize(0);return view"
  ];
  const digests = [];
  for (const source of sources) {
    const view = (await run(source)).returnValue;
    const digest = digestHostCallArguments([view]);
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(view))));
    expect(digestHostCallArguments([restored])).toBe(digest);
    digests.push(digest);
  }
  expect(new Set(digests).size).toBe(sources.length);
  expect(digests[0]).toBe("6779c25c432c61a0affa2ce24dfdba8cb90a574a58b82c4f319912d398b87d8a");
});

it("includes buffer metadata when hashing a view", () => {
  const first = new Float32Array(2);
  const second = new Float32Array(2);
  Object.defineProperty(first.buffer, "label", { value: "first" });
  Object.defineProperty(second.buffer, "label", { value: "second" });
  expect(digestHostCallArguments([first])).not.toBe(digestHostCallArguments([second]));
});

it("rejects view cycles through backing-buffer metadata", () => {
  const view = new Float32Array(2);
  Object.defineProperty(view.buffer, "owner", { value: view });
  expect(() => digestHostCallArguments([view])).toThrow("cannot contain cycles");
});

it("imports buffers supplied as initial bindings", async () => {
  const buffer = new ArrayBuffer(8);
  expect(await run("return buffer.byteLength", { bindings: { buffer } })).toMatchObject({ ok: true, returnValue: 8 });
});

it("imports buffers returned by host operations", async () => {
  const make = declareHostOperation(() => new ArrayBuffer(8), "re-issue");
  expect(await run("const buffer=await make();return buffer.byteLength", { bindings: { make } })).toMatchObject({ ok: true, returnValue: 8 });
});

it("exports guest buffers to host operations", async () => {
  const inspect = declareHostOperation((buffer: unknown) => buffer instanceof ArrayBuffer ? buffer.byteLength : -1, "re-issue");
  expect(await run("return await inspect(new ArrayBuffer(8))", { bindings: { inspect } })).toMatchObject({ ok: true, returnValue: 8 });
});

it("imports backing-buffer properties when the host supplies only a view", async () => {
  const buffer = new ArrayBuffer(8);
  const view = new Float32Array(buffer);
  Object.defineProperty(buffer, "owner", { value: view });
  expect(await run("return view.buffer.owner===view", { bindings: { view } })).toMatchObject({ ok: true, returnValue: true });
});
