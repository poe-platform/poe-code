import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const unique = [20, 50, 65, 100, 140, 170, 180, 205, 221];
const duplicates = [20, 50, 50, 100, 140, 170, 170, 205, 221];
const frame = (value: number) => Buffer.concat([Buffer.alloc(32 * 32, value), Buffer.alloc(32 * 32 * 2, 128)]);
const y4m = (values: number[]) => Buffer.concat([
  Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
  ...values.flatMap(value => [Buffer.from("FRAME\n"), frame(value)])
]);

async function run(selection: string[], twoInputs = true) {
  const volume = Volume.fromJSON({
    "/unique.y4m": y4m(unique), "/dup.y4m": y4m(duplicates), "/out.raw": "KEEP"
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/unique.y4m", ...(twoInputs ? ["-i", "/dup.y4m"] : []),
      ...selection, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2 reference hashes for the reported YUV444 clips.
for (const [filter, values, hash] of [
  ["null", unique, "0125ab102873c09947c30f9eb4ba4964e2a35c40243a2c0bd53752b7812f87f0"],
  ["decimate=cycle=4", [50, 65, 100, 170, 180, 205, 221], "a1ab13a22cc753d5421dea0e35a946885b80eca54c6c8ce78de952696b2224c9"]
] as const) {
  it(`maps only the labeled ${filter} output with two video inputs`, async () => {
    const result = await run(["-filter_complex", `[0:v]${filter}[only]`, "-map", "[only]"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(values.map(frame)));
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const [input, values] of [[0, unique], [1, duplicates]] as const) {
  for (const filtered of [false, true]) {
    it(`selects video input ${input} through ${filtered ? "a labeled filter chain" : "a direct map"}`, async () => {
      const result = await run(filtered
        ? ["-filter_complex", `[${input}:v:0]null,null[only]`, "-map", "[only]"]
        : ["-map", `${input}:v`]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, Buffer.concat(values.map(frame)));
    });
  }
}

it("preserves labeled filtering with a single input", async () => {
  const result = await run(["-filter_complex", "[0:v]null[only]", "-map", "[only]"], false);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat(unique.map(frame)));
});

for (const [graph, maps] of [
  ["[0:v]null[only]", ["[missing]"]],
  ["[0:v]null[only]", ["[only]", "[only]"]],
  ["[2:v]null[only]", ["[only]"]],
  ["[0:v:1]null[only]", ["[only]"]]
] as const) {
  it(`rejects unavailable or duplicate labels without replacing output: ${graph} / ${maps}`, async () => {
    const result = await run(["-filter_complex", graph, ...maps.flatMap(map => ["-map", map])], false);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}
