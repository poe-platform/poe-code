import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { readFileSync } from "node:fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 9.0.2 s16le hashes (matching the reported 7.0.2 prefixes) for the 8 kHz mono PCM16 fixture.
const input = readFileSync(new URL("./fixtures/vibrato-timeline.wav", import.meta.url));

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["asendcmd=c='0.3 vibrato enable 0',vibrato", "80fb8f355891963d66de207e130fcc0765c77e02386cd7bd21a382176aa7b92b"],
    ["asendcmd=c='0.3 vibrato enable 1',vibrato", "655e3162c084f689beb0de04bb60f156f73ead69125edf602b35504774904e59"],
    ["asendcmd=c='0.3 vibrato@one enable 0',vibrato@one", "80fb8f355891963d66de207e130fcc0765c77e02386cd7bd21a382176aa7b92b"],
    ["asendcmd=c='0.3 tremolo enable 0',tremolo", "f6a03a00e3558cfe22a3248e029397d6bb8e702d20ea82c559cacaa6e9a90f22"]
  ]) {
    it(`scheduled enable matches native PCM: ${filter} (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(filter!, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 12000 * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }

  for (const [scheduled, direct] of [
    ["asendcmd=c='0.3 vibrato enable ld(0)',vibrato=enable='st(0,1)'", "vibrato=enable='lt(t,0.3)'"],
    ["asendcmd=c='0.3 vibrato enable PI',vibrato=enable=0", "vibrato=enable='gte(t,0.3)'"],
    ["asendcmd=c='0.3 vibrato enable w',vibrato", "vibrato=enable='lt(t,0.3)'"],
    ["asendcmd=c='0.3 vibrato enable 0;0.8 vibrato enable 1',vibrato", "vibrato=enable='not(between(t,0.3,0.8))'"],
    ["asendcmd=c='0 vibrato enable 0;0.3 vibrato enable t/1.6',vibrato", "vibrato=enable='gte(t,0.8)'"],
    ["asendcmd=c='0 vibrato enable 0;0.3 vibrato enable invalid',vibrato", "anull"],
    ["asendcmd=c='0 vibrato enable 0',vibrato,vibrato", "vibrato"],
    ["asendcmd=c='0 vibrato@two enable 0',vibrato@one,vibrato@two", "vibrato"],
    ["asendcmd=c='0 vibrato@missing enable 0',vibrato", "vibrato"],
    ["asetnsamples=128:0,asendcmd=c='0.3 vibrato enable 0',vibrato", "asetnsamples=128:0,vibrato=enable='lt(t,0.3)'"],
    ["asetpts=PTS+4096,asendcmd=c='0.8 vibrato enable 0',vibrato", "asetpts=PTS+4096,vibrato=enable='lt(t,0.8)'"],
    ["asendcmd=c='2 vibrato enable 0',vibrato", "vibrato"]
  ]) {
    it(`routes and applies ${scheduled} (graph ${graph})`, async () => {
      const actual = await run(scheduled!, graph);
      const expected = await run(direct!, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(createHash("sha256").update(actual.output).digest("hex"),
        createHash("sha256").update(expected.output).digest("hex"));
    });
  }
}
