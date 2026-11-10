import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const early = "{25}{50}Early\n";
const late = "{75}{100}Late\n";
const expected = "1\n00:00:01,000 --> 00:00:02,000\nEarly\n\n2\n00:00:03,000 --> 00:00:04,000\nLate\n\n";

for (const ordered of [false, true]) {
  for (const explicit of [false, true]) {
    for (const sync of [false, true]) {
      it(`writes chronological SRT cues from ${ordered ? "ordered" : "out-of-order"} MicroDVD (${explicit ? "explicit" : "detected"}, ${sync ? "sync" : "async"})`, async () => {
        const input = "{1}{1}25\n" + (ordered ? early + late : late + early);
        const volume = Volume.fromJSON({ "/input.sub": input, "/out.srt": "KEEP" });
        const args = ["-v", "error", "-y", ...(explicit ? ["-f", "microdvd"] : []),
          "-i", "/input.sub", "-c:s", "srt", "/out.srt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
        assert.equal(volume.readFileSync("/out.srt", "utf8").toString().replaceAll("\r\n", "\n"), expected);
        assert.equal(volume.readFileSync("/input.sub", "utf8"), input);
      });
    }
  }
}
