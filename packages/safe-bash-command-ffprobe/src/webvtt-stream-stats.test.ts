import { expect, it } from "vitest";
import { webvttAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe leaves stream statistics unknown despite valid cue durations.
const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");

it("keeps WebVTT cue timing separate from unknown stream statistics", () => {
  const probe = webvttAst().probe(bytes, { showPackets: true });
  expect(probe.streams[0]!.duration_ts).toBeUndefined();
  expect(probe.streams[0]!.duration).toBeUndefined();
  expect(probe.streams[0]!.bit_rate).toBeUndefined();
  expect(probe.packets!.map(packet => [packet.pts, packet.duration])).toEqual([[1250, 1500], [4000, 500]]);
  expect(probe.format).toMatchObject({ format_name: "webvtt", size: "85" });
});

for (const stdin of [false, true]) for (const optional of ["auto", "always", "never"]) {
  it(`reports unknown WebVTT stream statistics with stdin=${stdin}, optional=${optional}`, async () => {
    const args = ["-v", "error", "-show_entries", "stream=duration,duration_ts,bit_rate", "-of", "json",
      "-show_optional_fields", optional, stdin ? "-" : "/voices.vtt"];
    const fs = new MemoryFileSystem();
    if (!stdin) await fs.writeFile("/voices.vtt", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    const expected = [optional === "always" ? { duration_ts: "N/A", duration: "N/A", bit_rate: "N/A" } : {}];
    expect(JSON.parse(output).streams).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!).streams).toEqual(expected);
  });
}
