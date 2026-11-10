import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { formatProbeText, xmlSection } from "./probe-text.js";

const taggedWav = Uint8Array.from(Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex"));
const cases = [
  {
    name: "selected format tag",
    bytes: taggedWav,
    entries: "format_tags=title",
    body: '    <format >\n        <tags>\n            <tag key="title" value="Title"/>\n        </tags>\n    </format>\n'
  },
  {
    name: "format attributes and tags",
    bytes: taggedWav,
    entries: "format=format_name:format_tags",
    body: '    <format format_name="wav">\n        <tags>\n            <tag key="title" value="Title"/>\n        </tags>\n    </format>\n'
  },
  {
    name: "untagged format",
    bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }),
    entries: "format_tags=title",
    body: '    <format />\n'
  }
];

for (const explicit of [false, true]) for (const stdin of [false, true]) {
  it.each(cases)(`writes ffprobe 7 XML $name (${explicit ? "explicit" : "automatic"}, ${stdin ? "stdin" : "file"})`, async ({ bytes, entries, body }) => {
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", "xml", "-show_entries", entries, stdin ? "-" : "/in.wav"];
    const expected = '<?xml version="1.0" encoding="UTF-8"?>\n<ffprobe>\n' + body + '</ffprobe>\n';
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
    expect(stdout).toBe(expected);
    expect(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)).toBe(expected);
  });
}

it.each(["format", "stream", "chapter"])("wraps and escapes streamed %s metadata", async section => {
  const text = { kind: "text" as const, async *chunks() { yield '<&"' + "😀".slice(0, 1); yield "😀".slice(1) + ">"; } };
  let output = "";
  for (const part of xmlSection({ tags: { 'title&"': text } }, section, 1)) {
    if (typeof part === "string") output += part;
    else for await (const chunk of formatProbeText(part)) output += chunk;
  }
  expect(output).toBe(`    <${section} >\n        <tags>\n            <tag key="title&amp;&quot;" value="&lt;&amp;&quot;😀&gt;"/>\n        </tags>\n    </${section}>\n`);
});
