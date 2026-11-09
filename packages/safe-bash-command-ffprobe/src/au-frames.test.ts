import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [samples, offset] of [[97, 32], [5001, 32], [97, 48]] as const) {
  it(`reports AU frame duration and source position for ${samples} stereo samples at offset ${offset}`, async () => {
    // A sliced input also checks that positions are relative to the file, not its backing buffer.
    const bytes = Buffer.alloc(16 + offset + samples * 4).subarray(16);
    [0x2e736e64, offset, samples * 4, 3, 8000, 2].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    // Native ffprobe uses 320-sample packets at 8 kHz, including a short final frame.
    const frames = Array.from({ length: Math.ceil(samples / 320) }, (_, index) => {
      const pts = index * 320;
      const duration = Math.min(320, samples - pts);
      return { pts, pkt_duration: duration, duration, duration_time: (duration / 8000).toFixed(6),
        pkt_pos: String(offset + pts * 4), pkt_size: String(duration * 4), nb_samples: duration };
    });
    const args = ["-v", "error", "-show_entries", "frame=pts,pkt_duration,duration,duration_time,pkt_pos,pkt_size,nb_samples", "-of", "json"];
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!)).toEqual({ frames });
    expect(auAst().probe(bytes, { showFrames: true }).frames).toMatchObject(frames);

    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments([...args, "/in.au"]), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toEqual({ frames });
  });
}
