import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe positions for these exact 85 bytes include each cue separator.
const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const packets = [{ pts: 1250, pos: "55", size: "7" }, { pts: 4000, pos: "85", size: "5" }];
const options = ["-v", "error", "-show_entries", "packet=pts,pos,size", "-of", "json"];

it("reports native WebVTT packet positions through synchronous ffprobe", () => {
  expect(JSON.parse(evalSyncFfprobe(bytes, [...options, "pipe:0"])!).packets).toMatchObject(packets);
});

for (const route of ["file", "stdin"]) {
  it(`reports native WebVTT packet positions through public ffprobe via ${route}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/voices.vtt", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments([...options, route === "stdin" ? "pipe:0" : "/voices.vtt"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(JSON.parse(output).packets).toMatchObject(packets);
  });
}
