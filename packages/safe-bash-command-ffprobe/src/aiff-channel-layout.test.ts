import { expect, it } from "vitest";
import { aiffAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe omits channel_layout without CHAN, even for mono/stereo.
for (const { name, hex, channels, samples, layout } of [
  { name: "mono without CHAN", channels: 1, samples: [1], layout: undefined,
    hex: "464f524d0000004041494646434f4d4d000000120001000000090010400bfa0000000000000053534e440000001a0000000000000000000100020003000400050006000700080009" },
  { name: "stereo without CHAN", channels: 2, samples: [1, 2], layout: undefined,
    hex: "464f524d0000003e41494646434f4d4d000000120002000000040010400bfa0000000000000053534e4400000018000000000000000000010002000300040005000600070008" },
  { name: "explicit FL+FR bitmap", channels: 2, samples: [1000, 9000], layout: "stereo",
    hex: "464f524d0000005241494646434f4d4d000000120002000000040010400bfa000000000000004348414e0000000c00010000000000030000000053534e4400000018000000000000000003e8232807d01f400bb81b580fa01770" }
]) {
  const bytes = Buffer.from(hex, "hex");
  const expected = { channels, ...(layout ? { channel_layout: layout } : {}) };

  it(`preserves AIFF layout and decoded channels in the SDK: ${name}`, () => {
    const stream = aiffAst().probe(bytes).streams[0]!;
    expect(stream.channels).toBe(channels);
    expect(stream.channel_layout).toBe(layout);
    const audio = aiffAst().parse(bytes).tracks[0]!.decodedAudio!;
    expect(audio.channels).toBe(channels);
    expect(audio.channelData.map(channel => channel[0])).toEqual(samples.map(sample => sample / 32768));
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    it(`reports AIFF layout through ${route}: ${name}`, async () => {
      const args = ["-v", "error", "-show_entries", "stream=channels,channel_layout", "-of", "json",
        ...(route === "explicit" ? ["-f", "aiff"] : []), route === "stdin" ? "pipe:0" : "/input.aiff"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.aiff", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        expect(diagnostic).toBe("");
      }
      expect(JSON.parse(output).streams).toEqual([expected]);
    });
  }
}
