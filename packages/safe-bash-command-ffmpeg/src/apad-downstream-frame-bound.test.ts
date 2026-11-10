import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 10 }, (_, index) => (index + 1) * 1000);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// The reported native FFmpeg outputs cover selection, trim, and finite-padding controls.
for (const graph of [false, true]) {
  for (const padding of ["", ":pad_len=12"]) {
    for (const [downstream, expected] of [
      ["aselect=not(mod(n\\,2))", [1000, 2000, 3000, 7000, 8000, 9000, 0, 0, 0, 0]],
      ["atrim=start_sample=5", [6000, 7000, 8000, 9000, 10000, 0, 0]],
      ["atrim=start_sample=5,aselect=not(mod(n\\,2))", [6000, 10000, 0, 0, 0, 0]],
      ["aselect=not(mod(n\\,2)),atrim=start_sample=5", [9000, 0, 0, 0, 0, 0, 0]],
      ["aselect=not(mod(st(0\\,ld(0)+1)\\,2))", [4000, 5000, 6000, 10000, 0, 0, 0, 0]],
      ["atrim=end_sample=5", [1000, 2000, 3000, 4000, 5000]]
    ] as const) {
      it(`apad${padding} satisfies the output frame cap after ${downstream} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=3:p=0,apad=packet_size=2${padding},${downstream}`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-frames:a", "4", "-f", "s16le", "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      });
    }
  }
}

for (const downstream of ["aselect=0", "atrim=start_sample=1000"]) {
  it(`bounds padding that cannot satisfy the output cap after ${downstream}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.02 } }).execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=3:p=0,apad=packet_size=2,${downstream}`, "-frames:a", "4", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("maxDurationSeconds"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}
