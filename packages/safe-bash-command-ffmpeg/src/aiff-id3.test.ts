import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.from("464f524d0000003441494646434f4d4d000000120001000000020010400bfa0000000000000053534e440000000c00000000000000001234fedc", "hex");

for (const sync of [false, true]) {
  for (const write of [undefined, "0", "1", "bad"]) {
    for (const version of [undefined, "3", "4", "0"]) {
      it(`AIFF ID3 sync=${sync} write=${write} version=${version}`, async () => {
        const volume = Volume.fromJSON({ "/out.aiff": "keep" });
        volume.writeFileSync("/in.aiff", input);
        const args = ["-v", "error", "-y", "-i", "/in.aiff", "-c:a", "copy", "-metadata", "album=DemoAlbum",
          ...(write === undefined ? [] : ["-write_id3v2", write]),
          ...(version === undefined ? [] : ["-id3v2_version", version]), "/out.aiff"];
        const invalid = write === "bad" || version === "0";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result === "", !invalid, result);
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
          assert.equal(result.exitCode, invalid ? 1 : 0, stderr);
        }
        const output = volume.readFileSync("/out.aiff") as Buffer;
        if (invalid) { assert.equal(output.toString(), "keep"); return; }
        assert.equal(output.readUInt32BE(4), output.length - 8);
        const chunks = new Map<string, Buffer>();
        for (let offset = 12; offset < output.length;) {
          const size = output.readUInt32BE(offset + 4);
          chunks.set(output.toString("ascii", offset, offset + 4), output.subarray(offset + 8, offset + 8 + size));
          offset += 8 + size + size % 2;
          assert.ok(offset <= output.length);
        }
        assert.deepEqual(chunks.get("SSND"), input.subarray(46));
        const id3 = chunks.get("ID3 ");
        assert.equal(!!id3, write === "1");
        if (id3) {
          assert.equal(id3.toString("ascii", 0, 3), "ID3");
          assert.equal(id3[3], Number(version ?? 4));
          const album = id3.indexOf("TALB");
          assert.ok(album >= 10);
          const frameSize = id3.readUInt32BE(album + 4);
          const payload = id3.subarray(album + 10, album + 10 + frameSize);
          assert.equal(payload[0], version === "3" ? 1 : 3);
          const text = new TextDecoder(version === "3" ? "utf-16le" : "utf-8").decode(payload.subarray(1));
          assert.equal(text.split("\0")[0], "DemoAlbum");
        }
      });
    }
  }
}
