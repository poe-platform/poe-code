import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pattern = [2000, 3000, 31000, 15000, 22000, 32000, 4000, 2000, 1000, 2000, 4000, 2000];
const input = Buffer.alloc(96 * 2);
for (let i = 0; i < 96; i++) input.writeInt16LE(pattern[i % pattern.length]!, i * 2);

async function run(release: number, command: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const filter = "asetnsamples=n=4:p=0,"
    + (command ? `asendcmd=c='${command}',` : "")
    + `alimiter@l=attack=4:release=${release}:asc=0:asc_level=0.5:level=0:limit=0.3:latency=0`;
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return { output: Buffer.concat(stdout), stderr };
}

for (const graph of [false, true]) {
  // Complete PCM16 hashes independently verified with native FFmpeg 7.0.2.
  for (const [release, command, hash] of [
    [50, "", "cd3f7b51b5efa48227de75f71fae2bc5a6718b471b463671a17a8e1c1ae3443d"],
    [2, "", "80771c2d3621065ff2ea3e12c9cdd02db6c484a05bd1292e89393f1179eeafc6"],
    [50, "0 alimiter@l release 2", "8bb43f9742618ad04892183c0c987538d29656ba1550bc8a72a73a1172e81661"],
    [50, "0.024 alimiter@l release 2", "e284b5353ca95ec486d7856068c20dde0bbca36d19656008769362771e94b690"],
    [50, "0.024 alimiter@l release 1+1", "e284b5353ca95ec486d7856068c20dde0bbca36d19656008769362771e94b690"],
    [50, "0.024 alimiter@other release 2", "cd3f7b51b5efa48227de75f71fae2bc5a6718b471b463671a17a8e1c1ae3443d"]
  ] as const) {
    it(`matches native release=${release}, ${command || "static"} (${graph ? "graph" : "simple"})`, async () => {
      const { output, stderr } = await run(release, command, graph);
      assert.equal(stderr, "");
      assert.equal(output.length, 192);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (command === "0.024 alimiter@l release 2") {
        const control = await run(50, "", graph);
        assert.deepEqual(output.subarray(0, 24 * 2), control.output.subarray(0, 24 * 2));
        assert.equal(output.readInt16LE(33 * 2), 1230);
        assert.equal(control.output.readInt16LE(33 * 2), 1284);
      }
    });
  }

  for (const invalid of ["0", "8001", "invalid"]) {
    it(`preserves the release envelope after rejected ${invalid} (${graph ? "graph" : "simple"})`, async () => {
      const { output } = await run(50, `0.024 alimiter@l release 2;0.048 alimiter@l release ${invalid}`, graph);
      assert.equal(output.length, 192);
      assert.equal(createHash("sha256").update(output).digest("hex"), "e284b5353ca95ec486d7856068c20dde0bbca36d19656008769362771e94b690");
    });
  }
}
