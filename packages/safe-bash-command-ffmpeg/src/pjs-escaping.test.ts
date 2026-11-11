import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const format of ["webvtt", "srt", "ass"]) {
      for (const [dialogue, expected, expectedAss] of [
        ["A{z}B", "A\\{z\\}B", "A\\{z\\}B"],
        ["A\\TB", "A\\\\TB", "A\\\\TB"],
        ["A\\nB", "A\\\nB", "A\\\\nB"],
        ["A\\NB", "A\\\nB", "A\\\\NB"],
        ["A|B", "A\nB", "A\\NB"],
        ["A\\hB", "A\\\\hB", "A\\\\hB"],
        ["A\\\\nB", "A\\\\\\\nB", "A\\\\\\\\nB"],
        ["A{\\b1}B", "A\\<b>B</b>", "A\\{\\\\b1\\}B"],
        ["A\\|B", "A\\\\\nB", "A\\\\\\NB"],
        ["A\\", "A\\\\", "A\\\\"],
        ["é{猫}\\N終", "é\\{猫\\}\\\n終", "é\\{猫\\}\\\\N終"]
      ] as const) {
        it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} PJS escaping matches native ${format} for ${JSON.stringify(dialogue)}`, async () => {
          const volume = Volume.fromJSON({ "/input.pjs": `10,20,"${dialogue}"\n` });
          const args = ["-v", "error", ...(forced ? ["-f", "pjs"] : []), "-i", "/input.pjs", "-f", format, sync ? "/out.txt" : "pipe:1"];
          let stdout = "";
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
              (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
            stdout = volume.readFileSync("/out.txt", "utf8") as string;
          } else {
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(),
              stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
              stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } as never);
            assert.equal(result.exitCode, 0, stderr);
            assert.equal(stderr, "");
          }
          if (format === "ass") {
            assert.equal(stdout.slice(stdout.indexOf("Dialogue:")),
              `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,${expectedAss}\n`);
          } else {
            assert.equal(stdout, format === "srt"
              ? `1\n00:00:01,000 --> 00:00:02,000\n${expected.replaceAll("\n", "\r\n")}\n\n`
              : `WEBVTT\n\n00:01.000 --> 00:02.000\n${expected}\n`);
          }
        });
      }
    }
  }
}
