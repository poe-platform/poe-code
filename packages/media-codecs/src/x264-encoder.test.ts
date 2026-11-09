import assert from "node:assert/strict";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { decodeH264 } from "./index.js";
import { encodeH264Preset, h264Presets } from "./x264-encoder.js";

const frames = Array.from({ length: 6 }, (_, pts) => ({
  y: new Uint8Array(256).fill(50 + pts * 10), u: new Uint8Array(64).fill(100), v: new Uint8Array(64).fill(150), pts, keyframe: false
}));

for (const preset of h264Presets) {
  it(`encodes and flushes every picture with ${preset}`, () => {
    const packets = [...encodeH264Preset(frames, 16, 16, 24, 1, preset)];
    assert.equal(packets.length, frames.length);
    const decoded = [...decodeH264(packets.map(packet => ({ ...packet, duration: 1 })), new Uint8Array(), 256)];
    assert.deepEqual(decoded.map(frame => frame.pts), frames.map(frame => frame.pts));
    for (let index = 0; index < packets.length - 1; index++) assert.ok(packets[index]!.dts < packets[index + 1]!.dts);
  });
}

it("releases preset encoders after malformed frames and early disposal", () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => [...encodeH264Preset([{ ...frames[0]!, y: new Uint8Array() }], 16, 16, 24, 1, "medium")], /planes/);
    const iterator = encodeH264Preset(frames, 16, 16, 24, 1, "medium");
    assert.equal(iterator.next().done, false);
    iterator.return(undefined);
  }
});

it("rejects invalid presets and dimensions before encoding", () => {
  assert.throws(() => [...encodeH264Preset(frames, 16, 16, 24, 1, "bogus")], /invalid preset 'bogus'/);
  assert.throws(() => [...encodeH264Preset(frames, 15, 16, 24, 1, "medium")], /even dimensions/);
});

it("encodes without Node, network, or runtime WebAssembly compilation", async () => {
  const bundled = await build({ entryPoints: [new URL("./x264-encoder.ts", import.meta.url).pathname],
    bundle: true, minify: true, write: false, platform: "browser", format: "iife", globalName: "codecs", logLevel: "silent" });
  const count = runInNewContext(bundled.outputFiles[0]!.text + '\n[...codecs.encodeH264Preset(frames, 16, 16, 24, 1, "medium")].length', {
    frames, TextEncoder, console,
    fetch() { throw new Error("Network access is forbidden"); },
    WebAssembly: new Proxy({}, { get() { throw new Error("Runtime WASM compilation is forbidden"); } })
  });
  assert.equal(count, frames.length);
});
