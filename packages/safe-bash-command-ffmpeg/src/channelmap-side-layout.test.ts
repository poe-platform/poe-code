import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const layout of ["5.1(side)", "0x60f", "FL+FR+FC+LFE+SL+SR"]) {
  for (const format of ["s16le", "wav"]) {
    it(`preserves samples and side speakers for channelmap ${layout} in ${format}`, async () => {
      const input = Buffer.from("6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd", "hex");
      const volume = new Volume();
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "6", "-channel_layout", "5.1",
          "-i", "/in.raw", "-af", `channelmap=0|1|2|3|4|5:${layout}`,
          "-c:a", "pcm_s16le", "-f", format, "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out") as Buffer;
      if (format === "s16le") {
        assert.deepEqual(output, input);
      } else {
        const audio = parseWav(output).tracks[0]!.decodedAudio!;
        assert.equal(audio.channelMask, 0x60f);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
          [[100, -100], [200, -200], [300, -300], [400, -400], [500, -500], [600, -600]]);
      }
    });
  }
}
