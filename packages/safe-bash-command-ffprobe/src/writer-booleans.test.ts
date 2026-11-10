import { expect, it } from "vitest";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";
import { formatTaggedAudio } from "./tag-format.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] });
const audio = parseAudio(bytes);
const tags = { count: 0, async *entries() {} };

async function execute(args: string[]) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/sample.wav", bytes);
  let stdout = "", stderr = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stdout, stderr };
}

for (const [value, enabled] of [["1", true], ["true", true], ["yes", true], ["on", true], ["TRUE", true], ["Yes", true], ["0", false], ["false", false], ["no", false], ["off", false], ["OFF", false]] as const) {
  for (const [writer, expected] of [
    [`default:nw=${value}:nk=${value}`, enabled ? "/sample.wav\n0.010000\n" : "[FORMAT]\nfilename=/sample.wav\nduration=0.010000\n[/FORMAT]\n"],
    [`default:noprint_wrappers=${value}:nokey=${value}`, enabled ? "/sample.wav\n0.010000\n" : "[FORMAT]\nfilename=/sample.wav\nduration=0.010000\n[/FORMAT]\n"],
    [`csv:p=${value}`, `${enabled ? "format," : ""}/sample.wav,0.010000\n`],
    [`compact:print_section=${value}:nokey=${value}`, enabled ? "format|/sample.wav|0.010000\n" : "filename=/sample.wav|duration=0.010000\n"]
  ]) it(`renders ${writer} across media and audio writers`, async () => {
    const args = ["-of", writer!, "-show_entries", "format=filename,duration", "/sample.wav"];
    expect(await execute(args)).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(expected);
    expect(probe(bytes, args)).toBe(expected);
    let output = "";
    for await (const chunk of formatTaggedAudio(audio, bytes.length, args, tags)) output += chunk;
    expect(output).toBe(expected);
  });
}

for (const option of ["default:nw", "default:nk", "default:noprint_wrappers", "default:nokey", "csv:p", "compact:print_section", "compact:nk", "ini:h", "ini:hierarchical", "json:c", "json:compact"]) {
  for (const value of ["bogus", "2", "-1", ""]) it(`rejects ${option}=${value} before output`, async () => {
    const args = ["-of", `${option}=${value}`, "-show_entries", "format=filename,duration", "/sample.wav"];
    const result = await execute(args);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("boolean");
    expect(evalSyncFfprobe(undefined, args, () => bytes)).toBeUndefined();
    if (!option.startsWith("json:")) {
      expect(() => probe(bytes, args)).toThrow("boolean");
      await expect(async () => { for await (const chunk of formatTaggedAudio(audio, bytes.length, args, tags)) void chunk; }).rejects.toThrow("boolean");
    }
  });
}

for (const value of ["true", "on", "1", "false", "off", "0"]) {
  const enabled = ["true", "on", "1"].includes(value);
  it(`renders JSON compact=${value}`, async () => {
    const args = ["-of", `json=compact=${value}`, "-show_entries", "format=filename", "/sample.wav"];
    const expected = enabled ? '{\n    "format": { "filename": "/sample.wav" }\n}\n' : '{\n    "format": {\n        "filename": "/sample.wav"\n    }\n}\n';
    expect(await execute(args)).toMatchObject({ exitCode: 0, stdout: expected });
  });
  it(`renders INI hierarchical=${value} across writers`, async () => {
    const args = ["-of", `ini:hierarchical=${value}`, "-show_entries", "stream=index", "/sample.wav"];
    const expected = `# ffprobe output\n\n\n\n[${enabled ? "streams." : ""}stream.0]\nindex=0\n`;
    expect(await execute(args)).toMatchObject({ exitCode: 0, stdout: expected });
    expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(expected);
    expect(probe(bytes, args)).toBe(expected);
    let output = "";
    for await (const chunk of formatTaggedAudio(audio, bytes.length, args, tags)) output += chunk;
    expect(output).toBe(expected);
  });
}
