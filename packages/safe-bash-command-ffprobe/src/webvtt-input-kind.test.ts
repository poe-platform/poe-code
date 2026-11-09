import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode("WEBVTT\n\nscene-A\n00:00.125 --> 00:00.625 align:end position:80%\nFirst\n\n00:00.750 --> 00:01.000\nSecond\n");
for (const kind of ["subtitles", "captions", "descriptions", "metadata"]) {
  it(`probes WebVTT ${kind} through both execution paths`, async () => {
    const args = ["-kind", kind, "-show_streams", "-show_packets", "-of", "json", "/cues.vtt"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/cues.vtt", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const json of [output, evalSyncFfprobe(bytes, args, () => bytes)]) {
      expect(json).toBeDefined();
      const probe = JSON.parse(json!);
      for (const name of ["captions", "descriptions", "metadata"]) {
        expect(probe.streams[0].disposition[name]).toBe(name === kind ? 1 : 0);
      }
      expect(probe.packets.map((packet: { pts: number; duration: number }) => [packet.pts, packet.duration]))
        .toEqual([[125, 500], [750, 250]]);
    }
  });
}

it("rejects unknown or missing WebVTT kinds", () => {
  expect(evalSyncFfprobe(bytes, ["-kind", "unknown", "/cues.vtt"], () => bytes)).toBeUndefined();
  expect(evalSyncFfprobe(bytes, ["/cues.vtt", "-kind"], () => bytes)).toBeUndefined();
});
