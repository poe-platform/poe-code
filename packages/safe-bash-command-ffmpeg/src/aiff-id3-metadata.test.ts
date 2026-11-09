import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg AIFF fixtures: identical PCM, with no ID3 or TALB in ID3v2.3/v2.4.
const fixtures = {"plain": "464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff8000", "tag3": "464f524d0000008041494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff800049443320000000414944330300000000003754414c420000000b00000044656d6f416c62756d00545353450000000e0000004c61766636312e312e313030000000000000000000000000", "tag4": "464f524d0000008041494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff800049443320000000414944330400000000003754414c420000000b00000344656d6f416c62756d00545353450000000e0000034c61766636312e312e313030000000000000000000000000"};

for (const [name, hex] of Object.entries(fixtures)) {
  for (const sync of [false, true]) {
    for (const copy of [false, true]) {
      it(`AIFF ${name} ${copy ? "PCM copy" : "album export"} (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({ "/in.aiff": Buffer.from(hex, "hex"), "/out": "keep" });
        const args = ["-v", "error", "-y", "-i", "/in.aiff",
          ...(copy ? ["-c:a", "copy", "-f", "s16be"] : ["-f", "ffmetadata"]), "/out"];
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
        const output = volume.readFileSync("/out") as Buffer;
        if (copy) assert.equal(output.toString("hex"), "1234fedc7fff8000");
        else {
          const lines = output.toString().trim().split("\n");
          assert.equal(lines[0], ";FFMETADATA1");
          assert.deepEqual(lines.filter(line => line.startsWith("album=")), name === "plain" ? [] : ["album=DemoAlbum"]);
        }
      });
    }
  }
}
