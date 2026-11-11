import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references for 4097 PCM16 samples at 8 kHz.
for (const graph of [false, true]) {
  for (const [filter, channels, format, checksum, planes, finalChecksum, finalPlanes, pcmHash] of [
    ["ashowinfo", 1, "s16", "B75CD34F", "B75CD34F", "00200020", "00200020", "0526be65e0fb8d4fc35e01f7bd9d9a2f5a508e5d757cfdc954079846d1c51fbd"],
    ["speechnorm,ashowinfo", 1, "fltp", "78C7B55B", "78C7B55B", "067C024C", "067C024C", "37120d4874ed358be55fb5469c3883b1c24d95d32bcaa6bd3d559dee6a11690f"],
    ["speechnorm=p=0.9,ashowinfo", 2, "fltp", "8AEA6502", "AEEBD6C8 37468E2B", "100903F8", "042201AF 052B0249", "4bda8de9631af41ad42d1a862c3bacb4d43955fd8bb5d685596aaadda132310e"],
    ["speechnorm=p=0.9,anull,ashowinfo", 2, "fltp", "8AEA6502", "AEEBD6C8 37468E2B", "100903F8", "042201AF 052B0249", "4bda8de9631af41ad42d1a862c3bacb4d43955fd8bb5d685596aaadda132310e"],
    ["speechnorm=p=0.9,aformat=f=s16,ashowinfo", 2, "s16", "6B8C0F5E", "6B8C0F5E", "043F0203", "043F0203", "4bda8de9631af41ad42d1a862c3bacb4d43955fd8bb5d685596aaadda132310e"]
  ] as const) it(`${filter} reports actual ${channels}-channel samples (${graph ? "graph" : "simple"})`, async () => {
    const pattern = [8192, -8192, 4000, -4000, 8193, -8193, 26000, -30000];
    const samples = Float64Array.from({ length: 4097 }, (_, i) => pattern[i % pattern.length]! / 32768);
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: channels === 1 ? [samples]
      : [samples, samples.map(value => Math.floor(-value * 16384) / 32768)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const frames = stderr.trim().split("\n");
    assert.equal(frames.length, 9);
    const description = `fmt:${format} channels:${channels} chlayout:${channels === 1 ? "mono" : "stereo"} rate:8000`;
    assert.equal(frames[0], `[ashowinfo] n:0 pts:0 pts_time:0 ${description} nb_samples:512 checksum:${checksum} plane_checksums: [ ${planes} ]`);
    assert.equal(frames[8], `[ashowinfo] n:8 pts:4096 pts_time:0.512 ${description} nb_samples:1 checksum:${finalChecksum} plane_checksums: [ ${finalPlanes} ]`);
    assert.equal(createHash("sha256").update(fs.readFileSync("/out.pcm") as Buffer).digest("hex"), pcmHash);
  });
}
