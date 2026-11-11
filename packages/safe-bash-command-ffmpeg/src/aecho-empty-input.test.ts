import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 drains five silent samples without PTS if no frame reached echo.
for (const complex of [false, true]) {
  for (const prefix of ["", "asetnsamples=n=4:p=0,"]) {
    for (const empty of ["aselect=0", "atrim=end_sample=0"]) {
      for (const [suffix, expected] of [
        ["", [0, 0, 0, 0, 0]],
        [",aselect=isnan(pts)", [0, 0, 0, 0, 0]],
        [",atrim=start=0.011:end=0.016", []]
      ] as const) {
        const filter = `${prefix}${empty},aecho=0.7:0.8:2|5:0.31|0.62${suffix}`;
        it(`${filter} leaves the empty-input tail untimed (${complex ? "complex" : "simple"})`, async () => {
          assert.deepEqual(await run(filter, complex), expected);
        });
      }
    }
    for (const [suffix, expected] of [
      [",aselect=isnan(pts)", []],
      [",atrim=start=0.011:end=0.016", [0, 0, 150, 0, 0]]
    ] as const) {
      const filter = `${prefix}aecho=0.7:0.8:2|5:0.31|0.62${suffix}`;
      it(`${filter} preserves the tail timestamp after input frames (${complex ? "complex" : "simple"})`, async () => {
        assert.deepEqual(await run(filter, complex), expected);
      });
    }
  }
}

async function run(filter: string, complex: boolean): Promise<number[]> {
  const samples = [1001, 0, 0, -2003, 0, 0, 0, 0, 303, 0, 0];
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
  const output = volume.readFileSync("/out.raw") as Buffer;
  return Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2));
}
