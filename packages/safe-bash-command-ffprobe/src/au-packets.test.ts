import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand } from "./media.js";

// Packet boundaries from ffprobe N-66595-gc2b38619c0-static.
for (const [name, rate, channels, length, declared, frames] of [
  ["long", 8000, 1, 16000, 0xffffffff, 320],
  ["longknown", 8000, 1, 16000, 16000, 320],
  ["long48", 48000, 1, 16000, 0xffffffff, 1024],
  ["stereo", 8000, 2, 16000, 0xffffffff, 320],
  ["plain", 8000, 1, 8, 8, 320]
] as const) {
  it(`reports individual ${name}.au packets through the public command`, async () => {
    const bytes = Buffer.alloc(24 + length);
    [0x2e736e64, 24, declared, 3, rate, channels].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    const expected = Array.from({ length: Math.ceil(length / (frames * channels * 2)) }, (_, index) => ({
      pts: index * frames,
      duration: Math.min(frames, length / (channels * 2) - index * frames),
      size: String(Math.min(frames * channels * 2, length - index * frames * channels * 2))
    }));
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(["-v", "error", "-show_packets", "-show_entries",
        "packet=pts,duration,size", "-of", "json", "/in.au"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).packets).toEqual(expected);
    const ast = auAst();
    const doc = ast.parse(bytes);
    expect(Buffer.concat(doc.tracks[0]!.samples.map(sample => sample.data))).toEqual(bytes.subarray(24));
    const copied = ast.serialize(doc, { audioCodec: "copy" });
    expect(ast.probe(copied, { showPackets: true }).packets).toMatchObject(expected);
    expect(() => ast.probe(bytes, { limits: { maxSamplesPerTrack: expected.length - 1 } })).toThrow(/limit/i);
  });
}
