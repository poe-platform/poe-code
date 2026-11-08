import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg IMA WAV: three 1024-byte blocks, each decoding to 2041 samples.
const header = "52494646560c000057415645666d74201400000011000100401f0000ad0f0000000404000200f9076661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461000c0000";
for (const [fact, duration] of [[0, 6144], [4096, 6144], [4097, 4097], [6123, 6123], [6500, 6500]] as const) {
  it(`keeps IMA fact=${fact} stream duration separate from packet duration`, async () => {
    const bytes = Buffer.concat([Buffer.from(header, "hex"), Buffer.alloc(3072)]);
    bytes.writeUInt32LE(fact, 48);
    const options = { showPackets: true };
    for (const probe of [await wavAst().probe!(bytes, options),
      await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }, options),
      await probeWavStream((async function* () { yield bytes.subarray(0, 50); yield bytes.subarray(50); })(), options)]) {
      expect(probe.streams[0]!.duration_ts).toBe(duration);
      expect(Array.from(probe.packets!, packet => packet.duration)).toEqual([6123]);
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.wav", bytes);
    for (const packets of [false, true]) {
      const args = ["-v", "error", ...(packets ? ["-show_packets"] : []), "-show_entries",
        "stream=duration_ts:packet=duration", "-of", "json", "/in.wav"];
      let output = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write() {} }
      });
      expect(result.exitCode).toBe(0);
      for (const probe of [JSON.parse(output), JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)]) {
        expect(probe.streams).toEqual([{ duration_ts: duration }]);
        if (packets) expect(probe.packets).toEqual([{ duration: 6123 }]);
      }
    }
  });
}
