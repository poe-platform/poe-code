import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { decodeAudio, decodeH264, encodeAudio, encodeOggAudio, scaleVideoPicture } from "./index.js";

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
  const mp3Packet = readFileSync(new URL("../../safe-bash-command-audio/fixtures/cbr.mp3", import.meta.url)).subarray(74, 458);
  const context = { TextEncoder, TextDecoder, URL, packet, aacPacket, aacConfig, mp3Packet, console,
    fetch() { throw new Error("Network access is forbidden"); },
    WebAssembly: new Proxy({}, { get() { throw new Error("Runtime WASM compilation is forbidden"); } })
  };
  const result = runInNewContext(bundled.outputFiles[0]!.text + '\nJSON.stringify([...codecs.decodeH264([{data: packet, pts: 0, dts: 0, duration: 1}], new Uint8Array(), 256)].map(frame => [frame.width, frame.height, codecs.scaleVideoPicture(frame, 8, 8)[0]]))', context, { timeout: 5000 });
  const aac = runInNewContext(bundled.outputFiles[0]!.text + '\nJSON.stringify([...codecs.decodeAudio("AAC", [{data: aacPacket, pts: 0, dts: 0, duration: 1024}], aacConfig)].map(frame => [frame.sampleRate, frame.channelData.length, frame.channelData[0].length]))', context, { timeout: 5000 });
  const mp3 = runInNewContext(bundled.outputFiles[0]!.text + '\nJSON.stringify([...codecs.decodeAudio("MP3", [{data: mp3Packet, pts: 0, dts: 0, duration: 1152}])].map(frame => [frame.sampleRate, frame.channelData.length, frame.channelData[0].length]))', context, { timeout: 5000 });
  assert.deepEqual(JSON.parse(mp3), [[48000, 2, 1152]]);
  assert.deepEqual(JSON.parse(aac), [[24000, 1, 1024]]);
  const opus = runInNewContext(bundled.outputFiles[0]!.text + '\nconst opus = codecs.encodeOggAudio("opus", 48000, [new Float32Array(64)]); JSON.stringify([...codecs.decodeAudio("Opus", opus.packets.map(packet => ({data: packet.data, pts: 0, dts: 0, duration: 960})), opus.headers[0])].map(frame => [frame.sampleRate, frame.channelData.length, frame.channelData[0].length]))', context, { timeout: 5000 });
  assert.deepEqual(JSON.parse(opus), [[48000, 1, 960]]);
  const encoded = runInNewContext(bundled.outputFiles[0]!.text + '\nJSON.stringify(["aac", "mp3"].map(codec => codecs.encodeAudio(codec, 8000, [Float32Array.of(0.5, -0.5)]).packets.map(packet => packet.length)))', context, { timeout: 5000 });
  assert.ok(JSON.parse(encoded).every((lengths: number[]) => lengths.length > 0 && lengths.every(length => length > 0)));
  const decoded = JSON.parse(result);
  assert.deepEqual(decoded[0].slice(0, 2), [16, 16]);
  assert.ok(decoded[0][2] >= 250);
});

const aacPacket = Buffer.from("3ABMYXZjNjMuMS4xMDIAAjivXelsLRMHQkLSWFvjx461XG+NNZe2qzhu9VV1KTcfUjmQn//0EpeAI4CaSfOIzohK/lSOWypKXPI0caSnTCG03BHbsztcqXFSlXlWVKUHAaGQot2lyEAiZJI4SI4pKCLJsAkwWdUkikIiFk4pFhM7PIrDk5eAhyEDKoP22QS3cO6SXcHxHuLjXpLZvDtm7q+o+nfC9rcy7O4bo6waep2wuLemuLeHbF19r3SW6dHatzFhbNZcNO27E5liclkbN4nq3MerdJ4rgd+xOZYnMs5w2Rs1tnrbPUNekaKy5tZc2suGwtets9QyVDJPNFI1KRqUjRUMlQyVRkqi9PNExgmMExgoFlAsoFlAsksExgmMExTJUyVlfsoFMlgmN8xvkqZKmtptptprvrvrvrvtptptptptvrvrvrvtptptvtvtvtvtO07b7byvK+2+eeeeeeeeeeeeeeeeeeeeeeeeecn4M8bkPDPkYn4G8aEPCXjUn4V8bEPCnjEn4g8gEPB/jAn4a8XkPFHkMn4a8ikPA3i0n4Y8akPCfisn4g8bEPDnkIn3vwsQ8ReKSfh/xWQ8OeJyfh7xEQ8UeKSfibxOQ8X+Nifh/xYQ8R+KyfiDxKQ8S+JCfinxMQ8WeJyfi7xYQ8V+K+A=", "base64");
const aacConfig = Uint8Array.from([19, 8, 86, 229, 0]);

it("releases AAC state after malformed packets and early iterator disposal", () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => [...decodeAudio("AAC", [{ data: Uint8Array.of(255), pts: 0, dts: 0, duration: 1024 }], aacConfig)], /AAC/);
    const frames = decodeAudio("AAC", [{ data: aacPacket, pts: 0, dts: 0, duration: 1024 }], aacConfig);
    const frame = frames.next().value!;
    assert.equal(frame.sampleRate, 24000);
    assert.equal(frame.channelData[0]!.length, 1024);
    frames.return(undefined);
  }
});


it("scales native pixels after decoder disposal and declines edited RGBA frames", () => {
  const frames = decodeH264([{ data: packet, pts: 0, dts: 0, duration: 1 }], new Uint8Array(), 256);
  const frame = frames.next().value!;
  frames.return(undefined);
  assert.deepEqual(scaleVideoPicture(frame, frame.width, frame.height), frame.data);
  const scaled = scaleVideoPicture(frame, 8, 8)!;
  assert.equal(scaled.length, 8 * 8 * 4);
  assert.ok(scaled[0]! >= 250);
  assert.equal(scaleVideoPicture({ ...frame, data: frame.data.slice() }, 8, 8), undefined);
  assert.equal(scaleVideoPicture({ ...frame, width: 8 }, 8, 8), undefined);
  assert.throws(() => scaleVideoPicture(frame, 0, 8), /dimensions/);
});

// Native AArch64 FFmpeg 9.0.2, raw YUV input with explicit colorspace/range, RGBA output.
for (const [format, colorspace, fullRange, digest] of [
  [12, 6, 1, "790c2b063bf5974bac396b4e7d357d8e9ae768ba939c86ec1be1401b49533639"],
  [13, 6, 1, "46b3fc1b4e40f6e063aaff5ba873a609ed7669bcf6d72bff46e4608ccfd4548e"],
  [0, 1, 0, "c16e1d291b34bb26759d2ba713e3a29a448a026de74fc841c5679bdb88044cda"],
  [0, 1, 1, "56e43f303a0ff49d1853ad74ca806c0194ddd8a62ae7d521420d8e48d8a1c1e1"],
  [0, 6, 0, "66a4bd6eb8b1c554157b60f77593dcb9f871899bcb35b1851d22a84aff180a9f"],
  [0, 6, 1, "790c2b063bf5974bac396b4e7d357d8e9ae768ba939c86ec1be1401b49533639"],
  [4, 1, 0, "53158bfa99b9e07f9c61c3f3dcea3f1acb6f38a829c2fa6631de98946a18b0b1"],
  [4, 1, 1, "284f8fc823ba6166ae17b4f50759e4e65c6de5d414c5437e0a12793479b81ceb"],
  [4, 6, 0, "29e04fe82d4c28c31d94ce174c65e9c9f2cebdaa19976eec8fcaccc746a20754"],
  [4, 6, 1, "46b3fc1b4e40f6e063aaff5ba873a609ed7669bcf6d72bff46e4608ccfd4548e"]
] as const) {
  it(`matches native unscaled YUV format ${format}, matrix ${colorspace}, range ${fullRange}`, async () => {
    const { createHash } = await import("node:crypto");
    const data = new Uint8Array(16 * 16 * 4);
    const pixels = Uint8Array.from({ length: 16 * 16 * (format === 0 || format === 12 ? 1.5 : 2) }, (_, i) => (i * 73 + Math.floor(i / 7)) % 256);
    const frame = { width: 16, height: 16, data,
      native: { width: 16, height: 16, rgba: data, pixels, format, colorspace, fullRange } };
    const actual = scaleVideoPicture(frame, 16, 16)!;
    assert.equal(createHash("sha256").update(actual).digest("hex"), digest);
  });
}

it("releases MP3 decoder state after errors and early iterator disposal", () => {
  const data = readFileSync(new URL("../../safe-bash-command-audio/fixtures/cbr.mp3", import.meta.url)).subarray(74, 458);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => [...decodeAudio("MP3", [{ data: Uint8Array.of(255), pts: 0, dts: 0, duration: 1152 }])], /MP3/);
    const frames = decodeAudio("MP3", [{ data, pts: 0, dts: 0, duration: 1152 }]);
    assert.equal(frames.next().value!.channelData[0]!.length, 1152);
    frames.return(undefined);
  }
});

it("decodes multiple AAC access units in one WAV packet", () => {
  const data = Buffer.concat([aacPacket, aacPacket]);
  const frames = [...decodeAudio("AAC", [{ data, pts: 0, dts: 0, duration: 2048 }], aacConfig)];
  assert.deepEqual(frames.map(frame => frame.channelData[0]!.length), [1024, 1024]);
});

for (const codec of ["aac", "mp3"] as const) {
  it(`releases ${codec} encoder state after invalid PCM`, () => {
    assert.throws(() => encodeAudio(codec, 8000, [Float32Array.of(Number.NaN)]), /finite/);
    assert.ok(encodeAudio(codec, 8000, [Float32Array.of(0.5)]).packets.length > 0);
    assert.throws(() => encodeAudio(codec, 12345, [Float32Array.of(0.5)]), /initialize/);
  });
}

it("decodes Opus packets with priming intact and cleans up after invalid headers", () => {
  assert.throws(() => [...decodeAudio("Opus", [], Uint8Array.of(1))], /Opus/);
  const encoded = encodeOggAudio("opus", 48000, [Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.1) * 0.4)]);
  const frames = [...decodeAudio("Opus", encoded.packets.map(packet => ({ data: packet.data, pts: 0, dts: 0, duration: 960 })), encoded.headers[0])];
  assert.equal(frames.length, encoded.packets.length);
  assert.ok(frames.every(frame => frame.sampleRate === 48000 && frame.channelData.length === 1 && frame.channelData[0]!.length === 960));
  assert.ok(frames[1]!.channelData[0]!.some(value => Math.abs(value) > 0.3));
});
