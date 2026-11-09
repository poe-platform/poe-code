import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function payload(bytes: Buffer): Buffer {
  const offset = bytes.indexOf("data") + 8;
  return bytes.subarray(offset, offset + bytes.readUInt32LE(offset - 4));
}

// Native FFmpeg copies two AC-3 packets and three MP2/MP3 packets at -t 0.08.
// Expected payloads are exact prefixes of the original encoded bytes.
for (const [codec, size, packetSize, packetTime] of [["ac3", 1152, 576, "0.048"], ["mp2", 5184, 1728, "0.036"], ["mp3", 648, 216, "0.036"]] as const) {
  for (const sync of [false, true]) {
    for (const trim of [undefined, "0.08", packetTime]) {
      it(`copies whole ${codec} WAV packets (${sync ? "sync" : "async"}, trim=${trim})`, async () => {
        const input = readFileSync(new URL(`./fixtures/copy-${codec}.wav`, import.meta.url));
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", input);
        const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "copy", ...(trim ? ["-t", trim] : []), "/out.wav"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
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
        const output = volume.readFileSync("/out.wav") as Buffer;
        assert.deepEqual(payload(output), trim ? payload(input).subarray(0, trim === packetTime ? packetSize : size) : payload(input));
      });
    }
  }
}
