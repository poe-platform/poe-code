import { expect, it } from "vitest";
import { createSyntheticMp4, parseMp4, probeMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

for (const fragmented of [false, true]) {
  it(`emits three-character MP4 packet flags, fragmented=${fragmented}`, async () => {
    const doc = parseMp4(createSyntheticMp4({ frameCount: 5, includeAudio: false }));
    const bytes = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index === 0 }))
    })) }, { fragmented });
    const expected = ["K__", "___", "___", "___", "___"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/clip.mp4", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(["-v", "error", "-show_packets", "-select_streams", "v:0", "-show_entries", "packet=flags", "-of", "json", "/clip.mp4"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toEqual({ packets: expected.map(flags => ({ flags })) });
    expect(probeMp4(bytes, { showPackets: true }).packets?.map(packet => packet.flags)).toEqual(expected);
  });
}
