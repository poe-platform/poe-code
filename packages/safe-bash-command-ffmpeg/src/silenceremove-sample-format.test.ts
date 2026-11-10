import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 524288009, -524287979, 0];

async function run(filter: string | undefined, complex: boolean, format = "s32le") {
  const input = Buffer.alloc(samples.length * (format === "f64le" ? 8 : 4));
  samples.forEach((value, index) => {
    if (format === "f64le") input.writeDoubleLE(value / 2147483648, index * 8);
    else input.writeInt32LE(value, index * 4);
  });
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", format, "-ar", "1000", "-ac", "1", "-i", "/in.raw",
      ...(filter === undefined ? [] : complex
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s32le", "-f", "s32le", "/out.raw"],
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
  return volume.readFileSync("/out.raw") as Buffer;
}

for (const complex of [false, true]) {
  // Native FFmpeg 7.0.2 converts signed PCM32 to float32 before silenceremove.
  for (const [filter, hex] of [
    ["silenceremove=window=0:start_periods=1", "0000401f2000c0e000000000"],
    ["silenceremove=window=0:stop_periods=-1", "000000000000401f2000c0e0"],
    ["silenceremove", "000000000000401f2000c0e000000000"],
    ["silenceremove=window=0:start_periods=1:enable=0", "000000000000401f2000c0e000000000"],
    ["anull", "000000000900401f1500c0e000000000"]
  ]) {
    it(`matches native PCM32 rounding through ${filter} (complex=${complex})`, async () => {
      assert.equal((await run(filter, complex)).toString("hex"), hex);
    });
  }

  it(`retains double precision through silenceremove (complex=${complex})`, async () => {
    assert.equal((await run("silenceremove=window=0:start_periods=1", complex, "f64le")).toString("hex"),
      "0900401f1500c0e000000000");
  });
}

it("preserves unfiltered signed PCM32 exactly", async () => {
  assert.equal((await run(undefined, false)).toString("hex"), "000000000900401f1500c0e000000000");
});
