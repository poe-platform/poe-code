import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Exact native FFmpeg input headers and decoded sample bytes.
const pcm = Buffer.from("000000bf0000803e000000000000403f0000003e000080be0000803f000080bf000060bf0000c03e0000000000000000", "hex");
const wav = Buffer.from("524946468400000057415645666d74201200000003000200112b0000885801000800200000006661637404000000060000004c4953541a000000494e464f495346540d0000004c61766636312e312e31303000006461746130000000", "hex");

for (const format of ["le", "be", "long", "wav", "bad"]) {
  for (const sync of [false, true]) {
    for (const explicit of format === "wav" ? [false] : [false, true]) {
      it(`decodes native float32 ${format}, sync=${sync}, explicit=${explicit}`, async () => {
        const input = format === "wav" ? Buffer.concat([wav, pcm]) : Buffer.alloc(1024 + (format === "long" ? 200 : 1) * pcm.length);
        if (format !== "wav") {
          Buffer.from(format === "le" ? "64a3010000442c460200000004000000" : "0001a364462c44000000000200000004", "hex").copy(input);
          const payload = format === "le" ? pcm : Buffer.from(pcm).swap32();
          for (let offset = 1024; offset < input.length; offset += payload.length) payload.copy(input, offset);
          if (format === "bad") input.write("FAIL");
        }
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in", input);
        const args = ["-v", "error", "-y", ...(explicit ? ["-f", "ircam"] : []), "-i", "/in", "-c:a", "pcm_f32le", "-f", "f32le", "/out.raw"];
        let diagnostic: string | undefined = "";
        if (sync) {
          diagnostic = evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        } else {
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { diagnostic += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, format === "bad" ? 1 : 0, diagnostic);
        }
        if (format === "bad") {
          assert.notEqual(diagnostic, "");
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        } else {
          assert.equal(diagnostic, "");
          assert.deepEqual(volume.readFileSync("/out.raw"), format === "long" ? Buffer.concat(Array.from({ length: 200 }, () => pcm)) : pcm);
        }
      });
    }
  }
}
