import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const samples of [8, 528]) for (const target of ["/input.wav", "-"]) {
  for (const writer of ["flat", "flat=h=0", "flat=hierarchical=0", "flat=s=_", "flat=sep_char=_"]) {
    for (const entries of ["packet=pts:frame=pts", "packet=pts", "frame=pts"]) {
      it(`writes ${entries} in native FLAT order: ${samples} samples, ${target}, ${writer}`, async () => {
        const bytes = samples === 8
          ? Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex")
          : encodeWav({ sampleRate: 8000, channels: [new Float64Array(samples)] });
        const args = ["-v", "error", "-of", writer, "-show_entries", entries, target];
        const sep = writer.endsWith("=_") ? "_" : ".";
        const combined = entries.includes(":");
        const sections = combined ? ["packet", "frame"] : [entries.split("=")[0]!];
        const expected = (samples === 8 ? [0] : [0, 512]).flatMap((pts, index) => sections.map(section => {
          const parent = writer.endsWith("=0") ? "" : (combined ? "packets_and_frames" : section + "s") + sep;
          return `${parent}${section}${sep}${index}${sep}pts=${pts}\n`;
        })).join("");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.wav", bytes);
        let stdout = "", stderr = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
        expect(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)).toBe(expected);
      });
    }
  }
}

it("retains decoder delay and flush order in combined FLAT output", async () => {
  const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.mp4", bytes);
  let output = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-select_streams", "v:0", "-of", "flat",
      "-show_entries", "packet=pts:frame=pts", "/input.mp4"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  expect(result.exitCode).toBe(0);
  const lines = output.trimEnd().split("\n");
  expect(lines.slice(0, 8)).toEqual([
    "packets_and_frames.packet.0.pts=0",
    "packets_and_frames.packet.1.pts=4096",
    "packets_and_frames.packet.2.pts=2048",
    "packets_and_frames.frame.0.pts=0",
    "packets_and_frames.packet.3.pts=1024",
    "packets_and_frames.frame.1.pts=1024",
    "packets_and_frames.packet.4.pts=3072",
    "packets_and_frames.frame.2.pts=2048"
  ]);
  expect(lines.slice(-2)).toEqual([
    "packets_and_frames.frame.18.pts=18432",
    "packets_and_frames.frame.19.pts=19456"
  ]);
});
