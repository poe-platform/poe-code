import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const after = Buffer.from("524946468800000057415645666d74201000000001000100401f0000803e00000200100064617461080000006400c8002c0190014c49535412000000494e464f494e414d0600000068656c6c6f00637565201c000000010000000c00000002000000646174610000000000000000020000004c495354160000006164746c6c61626c090000000c000000746573740000", "hex");

for (const before of [false, true]) for (const input of ["/in.wav", "pipe:0", "-"]) for (const sync of [false, true]) {
  it(`imports ${before ? "leading" : "trailing"} WAV cues from ${input} (${sync ? "sync" : "async"})`, async () => {
    const bytes = before ? Buffer.concat([after.subarray(0, 36), after.subarray(52), after.subarray(36, 52)]) : after;
    const volume = Volume.fromJSON({ "/in.wav": bytes });
    // Exclude container metadata so chapter presence is checked independently.
    const args = ["-v", "error", "-y", "-i", input, "-fflags", "+bitexact", "-map_metadata", "-1", "-f", "ffmetadata", "/out.meta"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(input === "/in.wav" ? undefined : bytes, args,
        path => volume.readFileSync(path) as Buffer,
        (path, data) => { volume.writeFileSync(path, data); return true; }), "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {
          for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
        })(),
        stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const metadata = volume.readFileSync("/out.meta", "utf8") as string;
    assert.equal(metadata.includes("[CHAPTER]"), before || input === "/in.wav");
    if (!before && input !== "/in.wav") assert.equal(metadata, ";FFMETADATA1\n");
  });
}
