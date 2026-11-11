import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const header = ";FFMETADATA1\ntitle=Album\nartist=Pat\n";
const first = "title=First\nartist=Ann\n";
const second = "title=Second\nartist=Bob\n";
const chapter = (start: number, end: number, tags: string) =>
  `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${end}\n${tags}`;
const input = header + chapter(500, 2200, first) + chapter(2200, 3500, second);

for (const sync of [false, true]) {
  for (const { name, offset, options, expected } of [
    { name: "positive offset", offset: "1.25", options: [], expected: chapter(1750, 3450, first) + chapter(3450, 4750, second) },
    { name: "negative offset clips at zero", offset: "-1", options: [], expected: chapter(0, 1200, first) + chapter(1200, 2500, second) },
    { name: "zero offset control", offset: "0", options: [], expected: chapter(500, 2200, first) + chapter(2200, 3500, second) },
    { name: "drops chapters before zero", offset: "-3", options: [], expected: chapter(0, 500, second) },
    { name: "retains chapter ending at zero", offset: "-2.2", options: [], expected: chapter(0, 0, first) + chapter(0, 1300, second) },
    { name: "output seek and duration", offset: "1.25", options: ["-ss", "2", "-t", "2"], expected: chapter(0, 1450, first) + chapter(1450, 2000, second) },
    { name: "output end time", offset: "1.25", options: ["-to", "3"], expected: chapter(1750, 3000, first) },
    { name: "output offset does not shift chapters", offset: "1.25", options: ["-output_ts_offset", "9"], expected: chapter(1750, 3450, first) + chapter(3450, 4750, second) },
    { name: "mapped input offset", offset: "9", options: ["-itsoffset", "-1", "-f", "ffmetadata", "-i", "/in.ffmeta", "-map_chapters", "1"], expected: chapter(0, 1200, first) + chapter(1200, 2500, second) },
    { name: "offset resets for next input", offset: "9", options: ["-f", "ffmetadata", "-i", "/in.ffmeta", "-map_chapters", "1"], expected: chapter(500, 2200, first) + chapter(2200, 3500, second) },
    { name: "disabled chapter mapping", offset: "1.25", options: ["-map_chapters", "-1"], expected: "" }
  ]) {
    it(`exports chapters with ${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.ffmeta": input });
      const args = ["-y", "-v", "error", "-itsoffset", offset, "-f", "ffmetadata", "-i", "/in.ffmeta",
        ...options, "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      assert.deepEqual(output.split("\n").filter(Boolean), (header + expected).split("\n").filter(Boolean));
    });
  }
}
