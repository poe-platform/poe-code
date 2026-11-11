import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`exports AU title, artist and album annotations while ignoring unsupported fields (${sync ? "sync" : "async"})`, async () => {
    const annotation = Buffer.from("Title=Evening\nArtist=Kay\nAlbum=Record\nComment=note\ncustom=solo\n\0");
    const header = Buffer.alloc(24);
    [0x2e736e64, 24 + annotation.length, 8, 3, 8000, 1]
      .forEach((value, index) => header.writeUInt32BE(value, index * 4));
    const input = Buffer.concat([header, annotation, Buffer.from("0064ff38012cfe70", "hex")]);
    const volume = Volume.fromJSON({ "/in.au": Buffer.from(input) });
    const args = ["-y", "-v", "error", "-i", "/in.au", "-f", "ffmetadata", "/out.ffmeta"];
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
    const lines = String(volume.readFileSync("/out.ffmeta", "utf8")).trim().split("\n").filter(line => !line.startsWith("encoder="));
    assert.deepEqual(lines.sort(), [";FFMETADATA1", "title=Evening", "artist=Kay", "album=Record"].sort());
  });
}
