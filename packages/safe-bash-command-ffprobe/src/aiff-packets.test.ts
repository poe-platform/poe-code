import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const frames of [5, 2048, 2049, 5000]) {
  it(`reports native AIFF packet boundaries, frames and counts for ${frames} PCM samples`, async () => {
    // Mono PCM16 at 8 kHz, with seven SSND offset bytes before the audio.
    const bytes = Buffer.alloc(62 + frames * 2);
    Buffer.from("464f524d0000000041494646434f4d4d000000120001000000000010400bfa0000000000000053534e44000000000000000700000010", "hex").copy(bytes);
    bytes.writeUInt32BE(bytes.length - 8, 4);
    bytes.writeUInt32BE(frames, 22);
    bytes.writeUInt32BE(15 + frames * 2, 42);
    const packets = [], decoded = [];
    for (let pts = 0; pts < frames; pts += 2048) {
      const duration = Math.min(2048, frames - pts);
      const pos = String(61 + pts * 2), size = String(duration * 2);
      packets.push({ pos, size, pts, duration });
      decoded.push({ pkt_pos: pos, pkt_size: size, pts, duration, nb_samples: duration });
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.aiff", bytes);
    for (const [entries, expected] of [
      ["packet=pos,size,pts,duration", { packets }],
      ["frame=nb_samples,pkt_pos,pkt_size,duration,pts", { frames: decoded }],
      ["stream=nb_read_frames,nb_read_packets", { programs: [], stream_groups: [], streams: [{ nb_read_frames: String(packets.length), nb_read_packets: String(packets.length) }] }]
    ] as const) {
      const args = ["-v", "error", "-count_frames", "-count_packets", "-show_entries", entries, "-of", "json"];
      expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!)).toEqual(expected);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments([...args, "/in.aiff"]), cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output)).toEqual(expected);
    }
  });
}
