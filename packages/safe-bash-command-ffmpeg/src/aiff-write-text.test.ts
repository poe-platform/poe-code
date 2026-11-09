import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const plain = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
// Native AIFF text chunks, with the same PCM as plain.
const tagged = Buffer.from("464f524d0000007241494646434f4d4d000000120001000000040010400bfa000000000000004e414d4500000004536f6e6741555448000000064172746973742863292000000009436f7079726967687400414e4e4f00000007436f6d6d656e740053534e440000001000000000000000000064ff38012cfe70", "hex");

for (const sync of [false, true]) {
  for (const mode of ["explicit", "inherited", "override", "empty", "disabled", "plain"] as const) {
    it(`${sync ? "sync" : "async"} AIFF stream copy writes ${mode} standard text metadata`, async () => {
      const input = mode === "plain" || mode === "explicit" ? plain : tagged;
      const volume = Volume.fromJSON({ "/in.aiff": input });
      const assignments = mode === "explicit" || mode === "override"
        ? ["author=Speaker", "comment=Interview", "copyright=Studio"]
        : mode === "empty" ? ["author=", "comment=", "copyright="] : [];
      const args = ["-v", "error", "-y", "-i", "/in.aiff", "-c", "copy",
        ...assignments.flatMap(value => ["-metadata", value]),
        ...(mode === "disabled" ? ["-map_metadata", "-1"] : []), "/out.aiff"];
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
      const bytes = volume.readFileSync("/out.aiff") as Buffer;
      const chunks = new Map<string, Buffer>();
      for (let offset = 12; offset < bytes.length;) {
        const size = bytes.readUInt32BE(offset + 4);
        chunks.set(bytes.toString("ascii", offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
        if (size % 2) assert.equal(bytes[offset + 8 + size], 0);
        offset += 8 + size + size % 2;
        assert.ok(offset <= bytes.length);
      }
      assert.equal(bytes.readUInt32BE(4), bytes.length - 8);
      assert.deepEqual(chunks.get("SSND"), plain.subarray(46));
      assert.equal(chunks.has("ID3 "), false);
      const values = ["AUTH", "ANNO", "(c) "].map(id => chunks.get(id)?.toString("utf8"));
      assert.deepEqual(values, mode === "explicit" || mode === "override" ? ["Speaker", "Interview", "Studio"]
        : mode === "inherited" ? ["Artist", "Comment", "Copyright"] : [undefined, undefined, undefined]);
      assert.equal(chunks.get("NAME")?.toString("utf8"), ["inherited", "override", "empty"].includes(mode) ? "Song" : undefined);
      if (mode === "plain" || mode === "disabled") assert.deepEqual(bytes, plain);
    });
  }
}
