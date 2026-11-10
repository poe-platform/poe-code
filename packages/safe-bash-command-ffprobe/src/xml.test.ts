import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

import { formatProbeText, xmlSection } from "./probe-text.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
const packetExpected = '<?xml version="1.0" encoding="UTF-8"?>\n<ffprobe>\n    <packets>\n        <packet size="32"/>\n    </packets>\n</ffprobe>\n';
const cases = [
  { name: "packet size", bytes, entries: "packet=size", expected: packetExpected },
  ...[
    { entries: "packet=pts:frame=pts", body: '    <packets_and_frames>\n        <packet pts="0"/>\n        <frame pts="0"/>\n    </packets_and_frames>\n' },
    { entries: "packet=pts", body: '    <packets>\n        <packet pts="0"/>\n    </packets>\n' },
    { entries: "frame=pts", body: '    <frames>\n        <frame pts="0"/>\n    </frames>\n' }
  ].map(({ entries, body }) => ({
    name: entries,
    bytes: Uint8Array.from(Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex")),
    entries,
    expected: '<?xml version="1.0" encoding="UTF-8"?>\n<ffprobe>\n' + body + '</ffprobe>\n'
  })),
  {
    name: "multiple packets and frames",
    bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(600)] }),
    entries: "packet=pts:frame=pts",
    expected: `<?xml version="1.0" encoding="UTF-8"?>
<ffprobe>
    <packets_and_frames>
        <packet pts="0"/>
        <frame pts="0"/>
        <packet pts="512"/>
        <frame pts="512"/>
    </packets_and_frames>
</ffprobe>
`
  }
];
for (const explicit of [false, true]) for (const stdin of [false, true]) {
  it.each(cases)(`writes native XML $name (${explicit ? "explicit" : "automatic"}, ${stdin ? "stdin" : "file"})`, async ({ bytes, entries, expected }) => {
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", "json", "-of", "xml", "-show_entries", entries, stdin ? "-" : "/in.wav"];
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

it("keeps delayed B-frames in decode order under the combined XML parent", async () => {
  const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.mp4", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([
      "-v", "error", "-select_streams", "v:0", "-show_packets", "-show_frames",
      "-show_entries", "packet=pts:frame=pts", "-of", "xml", "/input.mp4"
    ]), cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(output).toContain(`    <packets_and_frames>
        <packet pts="0"/>
        <packet pts="4096"/>
        <packet pts="2048"/>
        <frame pts="0"/>
        <packet pts="1024"/>
        <frame pts="1024"/>
        <packet pts="3072"/>
        <frame pts="2048"/>
`);
  expect(output).toContain(`        <frame pts="18432"/>
        <frame pts="19456"/>
    </packets_and_frames>
</ffprobe>
`);
});
