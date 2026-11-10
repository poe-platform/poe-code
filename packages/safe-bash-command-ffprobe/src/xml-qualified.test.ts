import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const bytes = Uint8Array.from(Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex"));
const qualifiedRoot = '<ffprobe:ffprobe xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ffprobe="http://www.ffmpeg.org/schema/ffprobe" xsi:schemaLocation="http://www.ffmpeg.org/schema/ffprobe ffprobe.xsd">';
const writers = [
  { writer: "xml", qualified: false },
  { writer: "xml=q=1", qualified: true },
  { writer: "xml=q=0", qualified: false },
  { writer: "xml=fully_qualified=1", qualified: true },
  { writer: "xml=fully_qualified=0", qualified: false },
  { writer: "xml=q=1:fully_qualified=0", qualified: false },
  { writer: "xml=fully_qualified=0:q=1", qualified: true }
];

for (const explicit of [false, true]) for (const stdin of [false, true]) {
  it.each(writers)(`writes $writer roots (${explicit ? "explicit" : "automatic"}, ${stdin ? "stdin" : "file"})`, async ({ writer, qualified }) => {
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", writer, "-show_entries", "format_tags=title", stdin ? "-" : "/in.wav"];
    const fs = new MemoryFileSystem();
    if (!stdin) await fs.writeFile("/in.wav", bytes);
    let stdout = "", stderr = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.split("\n").slice(0, 2)).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?>',
      qualified ? qualifiedRoot : "<ffprobe>"
    ]);
    expect(stdout).toContain('<tag key="title" value="Title"/>');
    expect(stdout.endsWith(qualified ? "</ffprobe:ffprobe>\n" : "</ffprobe>\n")).toBe(true);
    expect(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)).toBe(stdout);
  });
}
