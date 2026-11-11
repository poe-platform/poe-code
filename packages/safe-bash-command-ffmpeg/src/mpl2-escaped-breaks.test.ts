import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["webvtt", "srt"]) {
    for (const [dialogue, decoded] of [
      ["A\\NB", "A\nB"],
      ["A\\NB|C\\ND", "A\nB\nC\nD"],
      ["/Café\\NŻółć|End", "<i>Café\nŻółć</i>\nEnd"],
      ["A\\N/B", "A\n/B"],
      ["A|B", "A\nB"],
      ["A\\xB", "A\\xB"]
    ] as const) {
      it(`${sync ? "sync file" : "async pipe"} MPL2 to ${format} decodes escaped hard breaks: ${dialogue}`, async () => {
        const volume = Volume.fromJSON({ "/input.txt": `[10][20]${dialogue}\n` });
        const args = ["-v", "error", "-f", "mpl2", "-i", "/input.txt", "-f", format, sync ? "/output" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/output", "utf8") as string;
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
          assert.equal(result.exitCode, 0);
          assert.equal(stderr, "");
        }
        assert.equal(output, format === "srt"
          ? `1\n00:00:01,000 --> 00:00:02,000\n${decoded.replaceAll("\n", "\r\n")}\n\n`
          : `WEBVTT\n\n00:01.000 --> 00:02.000\n${decoded}\n`);
      });
    }
  }
}
