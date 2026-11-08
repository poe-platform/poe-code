import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [option, assignment] of [
    ["-metadata", "title"],
    ["-metadata:g", "title"],
    ["-metadata:s:a:0", "language"],
    ["-metadata", ""],
    ["-metadata", "title=Meeting"],
    ["-metadata", "title=Meeting=Notes"],
    ["-metadata", "title=  Meeting  "],
    ["-metadata:g", "title=  Meeting=Notes  "],
    ["-metadata", "title=   "],
    ["-metadata", "title="]
  ] as const) {
    it(`${sync ? "sync" : "async"} validates ${option} ${JSON.stringify(assignment)}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mp4", createSyntheticMp4({ frameCount: 1, includeAudio: true }));
      const args = ["-i", "/in.mp4", "-c", "copy", option, assignment, "/out.mp4"];
      const valid = assignment.includes("=");
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; });
        assert.equal(result, valid ? "" : undefined);
      } else {
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { errors.push(data); } }
        } as never);
        assert.equal(result.exitCode, valid ? 0 : 234);
        if (!valid) assert.ok(Buffer.concat(errors).toString().includes(`No '=' character in metadata string ${assignment}.`));
      }
      if (valid) {
        const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Uint8Array));
        assert.equal(output.metadata.title ?? "", assignment.slice(assignment.indexOf("=") + 1));
      } else {
        assert.equal(volume.existsSync("/out.mp4"), false);
      }
    });
  }
}
