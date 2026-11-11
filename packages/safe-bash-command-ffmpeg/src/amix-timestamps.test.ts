import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createHash } from "node:crypto";
import { createFfmpegCommand } from "./index.js";

async function mix(graph: string, missingPtsFixture = false) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  for (const [path, value] of [["/a.wav", 12000], ["/b.wav", -4000]] as const) {
    const channel = missingPtsFixture
      ? Float64Array.from(path === "/a.wav" ? [8000, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 2000, 0], value => value / 32768)
      : new Float64Array(path === "/a.wav" ? 2048 : 733).fill(value / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: missingPtsFixture ? 1000 : 8000,
      channels: [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "info", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", graph, "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

// Native FFmpeg 7.0.2 reference: the first input starts at 0.5 seconds.
for (const [shift, selector, bytes] of [
  [4000, "gte(t,0.5)", 4096],
  [4000, "not(t)", 0],
  [0, "not(t)", 1024]
] as const) {
  it(`preserves amix first-input offset ${shift} through aselect=${selector}`, async () => {
    const { result, volume, error } = await mix(
      `[0:a]asetpts=PTS+${shift}[x];[x][1:a]amix,aselect='${selector}'[o]`);
    assert.equal(result.exitCode, 0, error);
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, bytes);
    if (bytes === 4096) {
      assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), "e2cef1367f969d5b");
    }
  });
}

// Native FFmpeg 7.0.2: gaps affect frame timestamps, not PCM alignment.
for (const [branch, inputs, hex, timestamps] of [
  ["asetpts=PTS*3", "[x][1:a]", "d00700000000000000000000", [0, 6, 12, 18]],
  ["aselect='not(eq(n,1))'", "[x][1:a]", "d007000000000000", [0, 4, 6]],
  ["asetpts=PTS", "[x][1:a]", "0000000000000000", [0, 2, 4, 6]],
  ["asetpts=PTS+4", "[x][1:a]", "401f0000d00700000000000000000000", [4, 6, 8, 10]],
  ["asetpts=PTS*3", "[0:a][x]", "0000000000000000", [0, 4]]
] as const) {
  it(`keeps amix frame timing for ${branch} on ${inputs}`, async () => {
    for (const select of [false, true]) {
      const volume = Volume.fromJSON({});
      for (const [path, values] of [
        ["/a.wav", [8000, 0, 0, 0, 0, 0, 0, 0]],
        ["/b.wav", [0, 0, 2000, 0]]
      ] as const) {
        volume.writeFileSync(path, encodeWav({ sampleRate: 1000,
          channels: [Float64Array.from(values, value => value / 32768)] }));
      }
      const errors: Uint8Array[] = [];
      const output: Uint8Array[] = [];
      const source = inputs === "[0:a][x]" ? "1:a" : "0:a";
      const graph = `[${source}]asetnsamples=n=2:p=0,${branch}[x];${inputs}amix=normalize=0,` +
        (select ? "aselect='gt(t,0.003)'" : "ashowinfo") + "[o]";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", graph,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, stderr);
      if (select) assert.equal(Buffer.concat(output).toString("hex"), hex);
      else {
        const frames = stderr.split("\n").filter(line => line.includes("nb_samples:"));
        assert.equal(frames.length, timestamps.length, stderr);
        for (const [index, pts] of timestamps.entries()) {
          assert.ok(frames[index]!.includes(`n:${index} pts:${pts} pts_time:${pts / 1000} `), frames[index]);
        }
        assert.equal(Buffer.concat(output).toString("hex"), branch.startsWith("aselect")
          ? "401f0000d007000000000000" : "401f0000d00700000000000000000000");
      }
    }
  });
}

// Native FFmpeg 7.0.2: rescaling missing first-input PTS yields INT64_MIN + 1.
for (const [input, expression, timestamps] of [
  [0, "NAN", Array(4).fill("-9223372036854775807")],
  [0, "PTS", ["0", "2", "4", "6"]],
  [1, "NAN", ["0", "4"]]
] as const) {
  for (const select of [false, true]) {
    it(`matches amix PCM and timestamps with input ${input} asetpts=${expression}, selection=${select}`, async () => {
      const sources = input === 0 ? "[x][1:a]" : "[0:a][x]";
      const { result, volume, error } = await mix(
        `[${input}:a]asetnsamples=n=2:p=0,asetpts=${expression}[x];${sources}amix=normalize=0,ashowinfo${select ? ",aselect='isnan(pts)'" : ""}[o]`, true);
      assert.equal(result.exitCode, 0, error);
      assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"),
        select ? "" : "401f0000d00700000000000000000000");
      assert.deepEqual(error.split("\n").filter(line => line.startsWith("[ashowinfo]"))
        .map(line => line.split(" pts:")[1]!.split(" ")[0]), timestamps);
    });
  }
}
