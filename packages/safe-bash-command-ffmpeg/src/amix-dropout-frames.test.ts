import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function mix(graph: string, channels = 1, shortLength = 733, reverse = false) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  for (const [path, length, level] of [["/long.wav", 2048, 12000], ["/short.wav", shortLength, -4000]] as const) {
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: Array.from({ length: channels }, (_, channel) =>
        new Float64Array(length).fill((level + channel * 100) / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", reverse ? "/short.wav" : "/long.wav",
      "-i", reverse ? "/long.wav" : "/short.wav", "-filter_complex", graph,
      "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out.pcm") as Buffer;
}

// Native FFmpeg 7.0.2 PCM16 output at 8 kHz, including every channel and recovery sample.
for (const [channels, shortLength, frameSize, transition, hash] of [
  [1, 733, 128, 0.256, "d9b84057fd52897a8cae8e19b2e032f3c8c920675cfb8044a4ae4a14d0bbeccf"],
  [2, 733, 128, 0.256, "c74d32c51eefe65e45f19386e4229cd829ce9304b4de3c6cf9334306ae947be0"],
  [6, 733, 128, 0.256, "4b0faf51c1b5867ddf90692784218050a06478ec0017999927b2b7fff64f904d"],
  [1, 1024, 128, 0.256, "ea004fbed03be0575c3ba2141e700f2c08d4d3762858a4709fd12ae92140f724"],
  [1, 733, 300, 0.256, "19f09e291121b2ed4610a53d82ca9530e5075f28dfa10462570b30846612a430"],
  [1, 733, 128, 0, "4a91484a77c155a78f84c3ea69cbb204f3b5806aa8d97e15b44e92140f15c6ed"],
  [1, 733, 0, 0.256, "cf2697f543ada29c5b801f66c4e63c9245a040905088930f73bb2af1cd92ad2e"]
] as const) {
  it(`matches amix dropout frames: channels=${channels}, EOF=${shortLength}, frame=${frameSize}, transition=${transition}`, async () => {
    const prefix = frameSize ? `[0:a]asetnsamples=n=${frameSize}:p=0[x];[x]` : "[0:a]";
    const output = await mix(`${prefix}[1:a]amix=dropout_transition=${transition}[o]`, channels, shortLength);
    assert.equal(output.length, 2048 * channels * 2);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    if (shortLength === 733 && frameSize === 128 && transition) assert.equal(output.readInt16LE(733 * channels * 2), 6052);
  });
}

for (const [input, hash] of [
  [0, "cf2697f543ada29c5b801f66c4e63c9245a040905088930f73bb2af1cd92ad2e"],
  [1, "d9b84057fd52897a8cae8e19b2e032f3c8c920675cfb8044a4ae4a14d0bbeccf"]
] as const) {
  it(`uses surviving input frames after the first input ends, reframed input=${input}`, async () => {
    const output = await mix(`[${input}:a]asetnsamples=n=128:p=0[x];${input ? "[0:a][x]" : "[x][1:a]"}amix=dropout_transition=0.256[o]`, 1, 733, true);
    assert.equal(output.length, 2048 * 2);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const [prefix, count] of [["asetnsamples=n=128:p=0", 128],
  ["asetnsamples=n=128:p=0,atrim=start_sample=23", 105]] as const) {
  it(`preserves the incoming first frame for downstream selection: ${prefix}`, async () => {
    const output = await mix(`[0:a]${prefix}[x];[x][1:a]amix,aselect=not(n)[o]`);
    assert.equal(output.length, count * 2);
    for (let index = 0; index < count; index++) assert.equal(output.readInt16LE(index * 2), 4000);
  });
}
