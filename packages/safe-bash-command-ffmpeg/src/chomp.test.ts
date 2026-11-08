import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand } from "./index.js";

for (const filter of [undefined, "null", "chomp", "null,chomp,null"]) {
  it(`chomp framecrc: ${filter ?? "unfiltered"}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 20 }, (_, i) => (i + 1) / 32768)] }));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-c:a", "copy",
        ...(filter ? ["-bsf:a", filter] : []), "-f", "framecrc", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return fs.readFileSync(path); }, async stat(path: string) { return fs.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const rows = Buffer.concat(chunks).toString().split("\n").filter(line => line && !line.startsWith("#"));
    assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())),
      [["0", "0", "0", "20", filter?.includes("chomp") ? "39" : "40",
        filter?.includes("chomp") ? "0x0b3600d2" : "0x0c0800d2"]]);
  });
}

for (const type of ["audio", "video"] as const) {
  it(`chomp trims only trailing zeros on selected ${type} packets without mutating input`, () => {
    const template = parseWav(encodeWav({ sampleRate: 8000, channels: [new Float64Array(20)] })).tracks[0]!;
    const payloads = [[], [0, 0], [1, 0, 2], [0, 1, 0, 0]];
    const track = { ...template, type, samples: payloads.map(data => ({ ...template.samples[0]!, data: Uint8Array.from(data) })) };
    const other = { ...track, type: type === "audio" ? "video" as const : "audio" as const };
    const output = filterBitstream([track, other], "chomp,chomp", new MediaBudgetTracker(), type);
    assert.equal(output[1], other);
    assert.deepEqual(output[0]!.samples.map(sample => Array.from(sample.data)), [[], [], [1, 0, 2], [0, 1]]);
    assert.deepEqual(track.samples.map(sample => Array.from(sample.data)), payloads);
    output[0]!.samples.forEach((sample, i) => {
      assert.deepEqual({ ...sample, data: undefined }, { ...track.samples[i], data: undefined });
    });
  });
}
