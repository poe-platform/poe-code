import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 64 stereo PCM16 frames at 32 kHz.
const hashes = [
  "f63ff6fac0b5b98e3539e77ad8555aff700b19b9b7dac7893299bd30e97dcd7c",
  "41304cdd5ea0b2685fb88cc7b400e011b2648aa437d72106da0b9d26ddf9a85a"
];
const invalid = ["1.0", "0.0", "1e0", "0x1", "2", "-1"];

for (const graph of [false, true]) {
  for (const value of invalid) {
    for (const pipe of [false, true]) {
      it(`rejects startup listen=${value} (${graph ? "graph" : "simple"}, ${pipe ? "pipe" : "file"})`, async () => {
        const actual = await run(`aexciter=listen=${value}`, graph, pipe);
        assert.equal(actual.result.exitCode, 234, actual.stderr);
        assert.equal(actual.stdout.length, 0);
        assert.equal(actual.fs.readFileSync("/out.raw", "utf8"), "keep");
        assert.ok(actual.stderr.includes(`Unable to parse option value "${value}" as boolean`), actual.stderr);
      });
    }
    for (const initial of [0, 1]) {
      it(`keeps listen=${initial} after rejected runtime ${value} (${graph ? "graph" : "simple"})`, async () => {
        const actual = await run(`asetnsamples=n=8:p=0,asendcmd=c='0.001 aexciter@x listen ${value}',aexciter@x=listen=${initial}`, graph);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), hashes[initial]);
        assert.ok(actual.stderr.includes(`Unable to parse option value "${value}" as boolean`), actual.stderr);
      });
    }
  }
  for (const [canonical, values] of [[0, ["0", "+0", "-0", "00"]], [1, ["1", "+1", "01", "+001"]]] as const) {
    for (const value of values) {
      it(`preserves numeric listen=${value} (${graph ? "graph" : "simple"})`, async () => {
        for (const filter of [`aexciter=listen=${value}`, `aexciter=1:1:1:8.5:0:7500:9999:${value}`]) {
          const actual = await run(filter, graph);
          assert.equal(actual.result.exitCode, 0, actual.stderr);
          assert.equal(actual.stderr, "");
          assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), hashes[canonical]);
        }
        const scheduled = await run(`asetnsamples=n=8:p=0,asendcmd=c='0.001 aexciter@x listen ${value}',aexciter@x=amount=1`, graph);
        assert.equal(scheduled.result.exitCode, 0, scheduled.stderr);
        assert.equal(scheduled.stderr, "");
        assert.equal(createHash("sha256").update(scheduled.stdout).digest("hex"), canonical === 0
          ? hashes[0] : "c255d9558f650b0c4cf36687d251f0533a34ce9e46248a6f5055c96da0bfded4");
      });
    }
  }
  it(`continues valid updates after a rejected boolean (${graph ? "graph" : "simple"})`, async () => {
    const expected = await run("asetnsamples=n=8:p=0,asendcmd=c='0.0005 aexciter@x listen 1;0.0015 aexciter@x listen 0',aexciter@x", graph);
    const actual = await run("asetnsamples=n=8:p=0,asendcmd=c='0.0005 aexciter@x listen +01;0.001 aexciter@x listen 0.0;0.0015 aexciter@x listen -0',aexciter@x", graph);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.stdout, expected.stdout);
    assert.ok(actual.stderr.includes('Unable to parse option value "0.0" as boolean'), actual.stderr);
  });
  it(`honors quiet logging for rejected runtime booleans (${graph ? "graph" : "simple"})`, async () => {
    const actual = await run("asetnsamples=n=8:p=0,asendcmd=c='0.001 aexciter@x listen 1.0',aexciter@x", graph, true, "quiet");
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), hashes[0]);
  });
}

async function run(filter: string, graph: boolean, pipe = true, logLevel = "error") {
  const input = Buffer.alloc(256);
  for (let i = 0; i < 128; i++) input.writeInt16LE((i * 1453) % 52001 - 26000, i * 2);
  const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "keep" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", logLevel, "-f", "s16le", "-ar", "32000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", pipe ? "pipe:1" : "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, fs, stdout: Buffer.concat(stdout), stderr };
}
