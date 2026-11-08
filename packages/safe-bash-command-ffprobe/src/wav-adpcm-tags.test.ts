import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg headers from 4096 PCM16 mono samples at 8000 Hz.
// Payload contents do not affect probing; retain their original lengths.
const fixtures = [
  ["adpcm_ms", "52494646740c000057415645666d74203200000002000100401f0000b70f0000000404002000f407070000010000000200ff00000000c0004000f0000000cc0130ff880118ff6661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461000c0000", 3072],
  ["adpcm_yamaha", "524946465408000057415645666d74201200000020000100401f0000803e00000004040000006661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e31303100006461746100080000", 2048],
  ["g726", "524946465408000057415645666d74201200000045000100401f0000a00f00000100040000006661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e31303100006461746100080000", 2048],
  ["adpcm_ima_wav", "52494646560c000057415645666d74201400000011000100401f0000ad0f0000000404000200f9076661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461000c0000", 3072]
] as const;
for (const [encoding, header, size] of fixtures) {
  for (const packets of [false, true]) {
    it(`identifies ${encoding} and native duration with packets=${packets}`, async () => {
      const bytes = Buffer.concat([Buffer.from(header, "hex"), Buffer.alloc(size)]);
      const codec = encoding === "g726" ? "adpcm_g726" : encoding;
      const tag = encoding === "adpcm_ms" ? "[2][0][0][0]" : encoding === "adpcm_yamaha" ? " [0][0][0]" : encoding === "g726" ? "E[0][0][0]" : "[17][0][0][0]";
      const expected = [{ codec_name: codec, codec_tag_string: tag, channels: 1, sample_rate: "8000", duration_ts: encoding === "adpcm_ms" || encoding === "adpcm_ima_wav" ? 6144 : 4096 }];
      const args = ["-v", "error", "-f", "wav", ...(packets ? ["-show_packets"] : []), "-show_entries", "stream=codec_name,codec_tag_string,channels,sample_rate,duration_ts:packet=pos,size,duration", "-of", "json"];
      expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!).streams).toEqual(expected.map(({ duration_ts: _duration, ...stream }) => stream));
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.wav", bytes);
      for (const stdin of [false, true]) {
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments([...args, stdin ? "pipe:0" : "/in.wav"]),
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () { if (stdin) yield bytes; })(),
          stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        const probe = JSON.parse(output);
        if (packets) {
          expect(probe.packets.reduce((total: number, packet: { size: string }) => total + Number(packet.size), 0)).toBe(size);
        }
        expect(probe.streams).toEqual(stdin ? expected.map(({ duration_ts: _duration, ...stream }) => stream) : expected);
      }
    });
  }
}

for (const size of [1, 1025]) {
  it(`reports all ${size} IMA WAV payload bytes without decoding a truncated block`, async () => {
    const bytes = Buffer.concat([Buffer.from(fixtures[3][1], "hex"), Buffer.alloc(size)]);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.writeUInt32LE(size, 90);
    const expected = [{ pos: "94", size: String(size), ...(size === 1025 ? { duration: 2041 } : {}) }];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.wav", bytes);
    for (const target of ["/in.wav", "pipe:0"]) {
      const args = ["-v", "error", "-show_packets", "-show_entries",
        "stream=codec_name,codec_tag_string,channels,sample_rate,duration_ts:packet=pos,size,duration", "-of", "json", target];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { yield bytes; })(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      for (const probe of [JSON.parse(output), JSON.parse(evalSyncFfprobe(target === "pipe:0" ? bytes : undefined, args, () => bytes)!)]) {
        expect(probe.packets).toEqual(expected);
        expect(probe.streams).toEqual([{ codec_name: "adpcm_ima_wav", codec_tag_string: "[17][0][0][0]",
          channels: 1, sample_rate: "8000", ...(target === "/in.wav" ? { duration_ts: size * 2 } : {}) }]);
      }
    }
  });
}
