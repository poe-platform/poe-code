import assert from "node:assert/strict";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { decodeH264, encodeOggAudio } from "./index.js";

const packet = Buffer.from("AAAAAWdkAAqs2V7ARAAAAwAEAAADAAg8SJZYAAAAAWjr48siwAAAAQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAFliIQAFf/+7M9+BTZo5i/D8UVzjn2B", "base64");

it("decodes after malformed input and early iterator disposal", () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => [...decodeH264([{ data: Uint8Array.of(1, 2, 3), pts: 0, dts: 0, duration: 1 }], new Uint8Array(), 256)], /H.264/);
    const iterator = decodeH264([{ data: packet, pts: 0, dts: 0, duration: 1 }], new Uint8Array(), 256);
    const frame = iterator.next().value!;
    assert.equal(frame.width, 16);
    assert.ok(frame.data[0]! >= 250);
    iterator.return(undefined);
  }
});

it("cleans up encoders after invalid PCM", () => {
  assert.throws(() => encodeOggAudio("opus", 48000, [Float32Array.of(Number.NaN)]), /finite/);
  const encoded = encodeOggAudio("opus", 48000, [Float32Array.of(0)]);
  assert.equal(new TextDecoder().decode(encoded.headers[0]!.subarray(0, 8)), "OpusHead");
  assert.equal(encoded.packets.at(-1)!.granule - new DataView(encoded.headers[0]!.buffer).getUint16(10, true), 1);
});

it("runs in a browser sandbox without Node, network, or WebAssembly code generation", async () => {
  const bundled = await build({
    entryPoints: [new URL("./index.ts", import.meta.url).pathname],
    bundle: true, minify: true, write: false, platform: "browser", format: "iife", globalName: "codecs", logLevel: "silent"
  });
  const context = { TextEncoder, TextDecoder, URL, packet, console,
    fetch() { throw new Error("Network access is forbidden"); },
    WebAssembly: new Proxy({}, { get() { throw new Error("Runtime WASM compilation is forbidden"); } })
  };
  const result = runInNewContext(bundled.outputFiles[0]!.text + '\nJSON.stringify([...codecs.decodeH264([{data: packet, pts: 0, dts: 0, duration: 1}], new Uint8Array(), 256)].map(frame => [frame.width, frame.height, frame.data[0]]))', context, { timeout: 5000 });
  const decoded = JSON.parse(result);
  assert.deepEqual(decoded[0].slice(0, 2), [16, 16]);
  assert.ok(decoded[0][2] >= 250);
});
