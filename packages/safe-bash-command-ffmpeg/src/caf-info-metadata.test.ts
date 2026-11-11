import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: s16le 8000 Hz mono input, pcm_s16be CAF with the tags below.
// The input is independent of the safe CAF writer.
const caf = Buffer.from(
  "636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106368616e000000000000000c006400010000000000000000696e666f0000000000000077000000097469746c6500536f6e670061727469737400416c69636500616c62756d005265636f726400747261636b00320067656e726500466f6c6b0064617465003230303100636f6d6d656e74004e6f74650073657373696f6e00526f6f6d203400656e636f646572004c61766636312e312e3130300064617461000000000000000c000000000064ff38012cfe70", "hex");

for (const mode of ["metadata", "drop metadata", "decode"] as const) {
  for (const sync of [false, true]) {
    it(`reads native CAF info tags: ${mode} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.caf", caf);
      const args = ["-v", "error", "-y", "-i", "/in.caf",
        ...(mode === "drop metadata" ? ["-map_metadata", "-1"] : []),
        "-f", mode === "decode" ? "s16le" : "ffmetadata", "/out"];
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
      assert.deepEqual(volume.readFileSync("/in.caf"), caf);
      if (mode === "decode") {
        assert.deepEqual(volume.readFileSync("/out"), Buffer.from("640038ff2c0170fe", "hex"));
        return;
      }
      const lines = volume.readFileSync("/out", "utf8").toString().trim().split("\n")
        .filter(line => !line.startsWith("encoder="));
      assert.equal(lines[0], ";FFMETADATA1");
      assert.deepEqual(lines.slice(1).sort(), mode === "drop metadata" ? [] : [
        "album=Record", "artist=Alice", "comment=Note", "date=2001", "genre=Folk",
        "session=Room 4", "title=Song", "track=2"
      ]);
    });
  }
}
