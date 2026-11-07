import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

import { formatProbeText, xmlSection } from "./probe-text.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
const expected = '<?xml version="1.0" encoding="UTF-8"?>\n<ffprobe>\n    <packets>\n        <packet size="32"/>\n    </packets>\n</ffprobe>\n';
for (const explicit of [false, true]) for (const stdin of [false, true]) {
  it(`writes native XML packets (${explicit ? "explicit" : "automatic"}, ${stdin ? "stdin" : "file"})`, async () => {
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", "json", "-of", "xml", "-show_entries", "packet=size", stdin ? "-" : "/in.wav"];
    const fs = new MemoryFileSystem();
    if (!stdin) await fs.writeFile("/in.wav", bytes);
    let stdout = "", stderr = "";
    const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stdout).toBe(expected);
    expect(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)).toBe(expected);
  });
}

it("escapes streamed packet fields without losing split Unicode characters", async () => {
  const text = { kind: "text" as const, *chunks() { yield "<&\"'" + "😀".slice(0, 1); yield "😀".slice(1) + ">"; } };
  let output = "";
  for (const part of xmlSection({ size: "32", data: text }, "packet", 2)) {
    if (typeof part === "string") output += part;
    else for await (const chunk of formatProbeText(part)) output += chunk;
  }
  expect(output).toContain('data="&lt;&amp;&quot;&apos;😀&gt;"');
});
