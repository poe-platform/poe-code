import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

it("groups three complete IMA WAV blocks into a native demuxer packet", async () => {
  // Native FFmpeg header for 4096 PCM16 mono samples at 8000 Hz, padded to three blocks.
  const bytes = Buffer.concat([Buffer.from("52494646560c000057415645666d74201400000011000100401f0000ad0f0000000404000200f9076661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461000c0000", "hex"), Buffer.alloc(3072)]);
  // Packet reference: ffprobe N-66595-gc2b38619c0-static (newer versions use block packets).
  const expected = [{ pos: "94", size: "3072", duration: 6123 }];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.wav", bytes);
  for (const target of ["/in.wav", "pipe:0"]) {
    const args = ["-v", "error", "-show_packets", "-show_entries", "packet=pos,size,duration", "-of", "json", target];
    expect(JSON.parse(evalSyncFfprobe(target === "pipe:0" ? bytes : undefined, args, () => bytes)!).packets).toEqual(expected);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () { yield bytes; })(),
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).packets).toEqual(expected);
  }
});
