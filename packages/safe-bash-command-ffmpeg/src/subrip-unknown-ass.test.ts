import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMkv } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cases = [
  ['A<foo>B</foo>C', 'ABC'],
  ['A<foo><bar>B</bar>C</foo>D', 'ABCD'],
  ['A<foo class="example">B</foo>C', 'ABC'],
  ['plain &amp; &lt; &gt; <00:01.000>', 'plain &amp; &lt; &gt; <00:01.000>']
];
for (const sync of [false, true]) {
  for (const format of ["ass", "mkv"]) {
    for (const [text, expected] of cases) {
      it(`removes unknown SubRip tags when encoding ${format} (sync=${sync}): ${text}`, async () => {
        const volume = Volume.fromJSON({ "/in.srt": `1\n00:00:01,000 --> 00:00:02,000\n${text}\n` });
        const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
        const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
        const target = `/out.${format}`;
        const args = ["-y", "-v", "error", "-i", "/in.srt", "-c:s", "ass", target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, read, write), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { write(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const bytes = volume.readFileSync(target) as Buffer;
        if (format === "ass") {
          assert.deepEqual(bytes.toString().split("\n").filter(line => line.startsWith("Dialogue:")),
            [`Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,${expected}`]);
        } else {
          const samples = parseMkv(bytes).tracks[0]!.samples;
          assert.deepEqual(samples.map(sample => [sample.pts, sample.duration, Buffer.from(sample.data).toString()]),
            [[1000, 1000, `0,0,Default,,0,0,0,,${expected}`]]);
        }
      });
    }
  }
}
