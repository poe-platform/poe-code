import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { formatFfprobeResult, formatFfprobeSourceChunks } from "./media.js";
import { probe } from "./probe.js";

const title = 'a,b|c"d\\e\nf\rg';
const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }, { tags: { title } });
const cases = [
  ["compact", 'format|tag:title=a,b\\|c"d\\\\e\\nf\\rg\n'],
  ["csv", 'format,"a,b|c""d\\e\nf\rg"\n'],
  ["compact=e=csv", 'format|tag:title="a,b|c""d\\e\nf\rg"\n'],
  ["compact=escape=csv", 'format|tag:title="a,b|c""d\\e\nf\rg"\n'],
  ["compact=e=none", `format|tag:title=${title}\n`],
  ["compact=escape=none", `format|tag:title=${title}\n`],
  ["compact=e=c", 'format|tag:title=a,b\\|c"d\\\\e\\nf\\rg\n'],
  ["csv=e=c", 'format,a\\,b|c"d\\\\e\\nf\\rg\n'],
  ["csv=escape=c", 'format,a\\,b|c"d\\\\e\\nf\\rg\n'],
  ["csv=e=none", `format,${title}\n`],
  ["csv=escape=none", `format,${title}\n`],
  ["csv=e=csv", 'format,"a,b|c""d\\e\nf\rg"\n'],
  ["compact=e=csv:s=;", 'format;tag:title="a,b|c""d\\e\nf\rg"\n'],
  ["csv=e=c:s=|", 'format|a,b\\|c"d\\\\e\\nf\\rg\n']
] as const;

for (const [writer, expected] of cases) {
  for (const route of ["audio", "media", "readFile"] as const) it(`writes literal ${writer} output through ${route}`, async () => {
    const base = new MemoryFileSystem();
    await base.writeFile("/input.wav", bytes);
    const fs = route === "readFile" ? new Proxy(base, { get(target, key) {
      if (key === "open") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }) : base;
    const args = [...(route === "media" ? ["-f", "wav"] : []), "-v", "error", "-of", writer, "-show_entries", "format_tags=title", "/input.wav"];
    let stdout = "", stderr = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });

  it(`formats audio, media and chunked metadata with ${writer}`, async () => {
    expect(probe(bytes, ["-of", writer.replace("=", ":"), "-show_entries", "format_tags=title", "/input.wav"])).toBe(expected);
    const media = wavAst().probe(bytes);
    const options = { printFormat: writer, showEntries: "format_tags=title", showFormat: false, showStreams: false, showPackets: false, showFrames: false, showChapters: false, showPrograms: false };
    expect(formatFfprobeResult(media, options)).toBe(expected);
    const text = { kind: "text" as const, async *chunks() { yield* title; } };
    let output = "";
    for await (const part of formatFfprobeSourceChunks({ ...media, format: { ...media.format, tags: { title: text } } }, options)) output += part;
    expect(output).toBe(expected);
  });
}

for (const writer of ["compact=e=invalid", "csv=escape=invalid"]) it(`rejects ${writer} without publishing output`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.wav", bytes);
  let stdout = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-of", writer, "-show_format", "/input.wav"]), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(1);
  expect(stdout).toBe("");
  expect(() => probe(bytes, ["-of", writer.replace("=", ":"), "-show_format", "/input.wav"])).toThrow();
});
