import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Exact FFmpeg 7.0.2 output for LRC input headers.
const cases = [
  { header: "[ti:Verse]\n[ar:Band]\n[al:Book]\n[au:Writer]\n",
    metadata: "title=Verse\nartist=Band\nalbum=Book\nauthor=Writer\n" },
  { header: "[length:02:00]\n", metadata: "length=02:00\n" },
  { header: "[offset:500]\n", metadata: "" },
  { header: "", metadata: "" }
];

for (const sync of [false, true]) {
  for (const explicit of [false, true]) {
    for (const { header, metadata } of cases) {
      it(`${sync ? "sync" : "async"} imports LRC metadata (${explicit ? "explicit" : "detected"}): ${header}`, async () => {
        const volume = Volume.fromJSON({ "/in.lrc": `${header}[00:05.00]end\n` });
        const args = ["-v", "error", ...(explicit ? ["-f", "lrc"] : []), "-i", "/in.lrc",
          "-bitexact", "-f", "ffmetadata", sync ? "/out" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/out", "utf8").toString();
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(output, `;FFMETADATA1\n${metadata}`);
      });
    }
  }
}
