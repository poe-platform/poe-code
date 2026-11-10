import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const wav = Uint8Array.from(Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex"));
const qualifiedRoot = '<ffprobe:ffprobe xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ffprobe="http://www.ffmpeg.org/schema/ffprobe" xsi:schemaLocation="http://www.ffmpeg.org/schema/ffprobe ffprobe.xsd">';

async function run(args: string[], bytes = wav) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", bytes);
  let stdout = "", stderr = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stdout, stderr };
}

for (const explicit of [false, true]) {
  it.each([
    { writer: "xml=x=1", flags: ["-noprivate"], strict: true },
    { writer: "xml=xsd_strict=1", flags: ["-noprivate"], strict: true },
    { writer: "xml=x=1:q=0", flags: ["-noprivate"], strict: true },
    { writer: "xml=x=0", flags: [], strict: false },
    { writer: "xml=xsd_strict=0", flags: [], strict: false },
    { writer: "xml=x=1:xsd_strict=0", flags: [], strict: false },
    { writer: "xml=xsd_strict=0:x=1", flags: ["-noprivate"], strict: true },
    { writer: "xml=x=1", flags: ["-private", "-noprivate"], strict: true },
    { writer: "xml=x=1", flags: ["-noshow_private_data"], strict: true }
  ])(`renders $writer with $flags (${explicit ? "explicit" : "automatic"} WAV)`, async ({ writer, flags, strict }) => {
    const args = ["-v", "error", ...flags, ...(explicit ? ["-f", "wav"] : []), "-of", writer, "-show_entries", "format=size", "/input"];
    const expected = '<?xml version="1.0" encoding="UTF-8"?>\n' + (strict ? qualifiedRoot : "<ffprobe>") + '\n    <format size="86"/>\n' + (strict ? "</ffprobe:ffprobe>\n" : "</ffprobe>\n");
    expect(await run(args)).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    expect(evalSyncFfprobe(undefined, args, () => wav)).toBe(expected);
  });
}

it("renders strict XML from stdin", async () => {
  const args = ["-noprivate", "-of", "xml=x=1", "-show_entries", "format=format_name", "-"];
  const result = await run(args);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain(qualifiedRoot);
  expect(result.stdout).toContain('<format format_name="wav"/>');
  expect(evalSyncFfprobe(wav, args)).toBe(result.stdout);
});

it.each([
  { flags: [], option: "private" },
  { flags: ["-noprivate", "-private"], option: "private" },
  { flags: ["-noprivate", "-show_private_data"], option: "private" },
  { flags: ["-noprivate", "-unit"], option: "unit" },
  { flags: ["-noprivate", "-prefix"], option: "prefix" }
])("rejects incompatible strict XML options $flags before writing output", async ({ flags, option }) => {
  const args = [...flags, "-of", "xml=x=1", "-show_entries", "format=size", "/input"];
  const result = await run(args);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`XSD-compliant output selected but option '${option}' was selected`);
  expect(result.stderr).toContain(`You need to disable such option with '-no${option}'`);
  expect(evalSyncFfprobe(undefined, args, () => wav)).toBeUndefined();
});

it.each(["xml=x=invalid", "xml=xsd_strict=invalid", "json=x=1"])("rejects invalid writer option %s", async writer => {
  const result = await run(["-noprivate", "-of", writer, "/input"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("Unknown option -noprivate");
});

it.each([[], ["-noprivate"], ["-noshow_private_data"], ["-noprivate", "-private"]])("honors codec-private field selection %j", async (...flags) => {
  const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
  const args = [...flags, "-of", "json", "-show_entries", "stream=codec_name,is_avc,nal_length_size", "/input"];
  const result = await run(args, bytes);
  expect(result.exitCode, result.stderr).toBe(0);
  const stream = JSON.parse(result.stdout).streams[0];
  expect(stream.codec_name).toBe("h264");
  if (!flags.length || flags.at(-1) === "-private") {
    expect(stream.is_avc).toBe("true");
    expect(stream.nal_length_size).toBe("4");
  } else {
    expect(stream).not.toHaveProperty("is_avc");
    expect(stream).not.toHaveProperty("nal_length_size");
  }
  expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(result.stdout);
});

it("omits H.264 private fields in strict XML while retaining codec data size", async () => {
  const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
  const args = ["-noprivate", "-of", "xml=xsd_strict=1", "-show_entries", "stream=codec_name,is_avc,nal_length_size,extradata_size", "/input"];
  const result = await run(args, bytes);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain(qualifiedRoot);
  expect(result.stdout).toContain('codec_name="h264"');
  expect(result.stdout).toContain('extradata_size="');
  expect(result.stdout).not.toContain("is_avc=");
  expect(result.stdout).not.toContain("nal_length_size=");
  expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(result.stdout);
});
