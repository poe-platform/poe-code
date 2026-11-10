import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";

const bad = Uint8Array.from(Buffer.from("524946464c00000057415645666d74201000000001000100401f0000803e0000020010004c49535410000000494e464f494e414d0400000061ff6200646174611000000000000000000000000000000000000000", "hex"));
const good = Uint8Array.from(Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex"));

async function run(bytes: Uint8Array, writer: string, stdin: boolean | "inline" = false, explicit = false, entries = "format_tags=title", quiet = false) {
  const fs = new MemoryFileSystem();
  if (!stdin) await fs.writeFile("/input.wav", bytes);
  const args = ["-v", quiet ? "quiet" : "error", ...(explicit ? ["-f", "wav"] : []), "-of", writer, "-show_entries", entries, stdin === "inline" ? `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}` : stdin ? "-" : "/input.wav"];
  const output: Uint8Array[] = []; let stderr = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { if (stdin === true) { yield bytes.subarray(0, 57); yield bytes.subarray(57); } } },
    stdout: { async write(chunk) { output.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { exitCode: result.exitCode, stdout: Buffer.concat(output), stderr };
}

for (const stdin of [false, true]) for (const explicit of [false, true]) {
  const path = `${stdin ? "stdin" : "file"}, ${explicit ? "explicit WAV" : "detected WAV"}`;
  it(`accepts valid UTF-8 with fail validation (${path})`, async () => {
    const result = await run(good, "json=sv=fail", stdin, explicit);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.toString())).toEqual({ format: { tags: { title: "Title" } } });
  });
  for (const [options, title] of [["sv=replace", "a�b"], ["string_validation=replace:svr=?", "a?b"], ["sv=replace:string_validation_replacement=", "ab"]]) {
    it(`replaces malformed UTF-8 with ${options} (${path})`, async () => {
      const result = await run(bad, `json=${options}`, stdin, explicit);
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout.toString())).toEqual({ format: { tags: { title } } });
    });
  }
  it(`preserves original invalid bytes in ignore mode (${path})`, async () => {
    const result = await run(bad, "json=sv=ignore", stdin, explicit);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(result.stdout.includes(Buffer.from([0x61, 0xff, 0x62]))).toBe(true);
    expect(result.stdout.includes(Buffer.from("\\udcff"))).toBe(false);
  });
  it(`returns failure and complete JSON without the invalid tag (${path})`, async () => {
    const result = await run(bad, "json=string_validation=fail", stdin, explicit);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString())).toEqual({ format: { tags: {} } });
    expect(result.stderr).toContain("Invalid UTF-8");
  });
}

it("does not reject a valid replacement character or multibyte Unicode", async () => {
  const title = "a�b 日本 😀";
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { tags: { title } });
  const result = await run(bytes, "json=sv=fail");
  expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.toString()).format.tags.title).toBe(title);
});
it("does not validate an unselected tag", async () => {
  const result = await run(bad, "json=sv=fail", false, false, "format=nb_streams");
  expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
});
it("keeps failure status and complete output with quiet logging", async () => {
  const result = await run(bad, "json=sv=fail", false, false, "format_tags=title", true);
  expect(result.exitCode).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.toString())).toEqual({ format: { tags: {} } });
});
for (const writer of ["default", "compact", "csv", "flat", "ini", "xml"]) {
  it(`applies replacement to the ${writer} writer`, async () => {
    const result = await run(bad, `${writer}=sv=replace:svr=?`);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(result.stdout.toString()).toContain("a?b");
  });
}
it("rejects unknown validation modes before producing output", async () => {
  const result = await run(good, "json=sv=unknown");
  expect(result.exitCode).toBe(1); expect(result.stdout.length).toBe(0);
  expect(result.stderr).toContain("Invalid string validation mode");
});

it("preserves valid UTF-8 across metadata read boundaries and literal JSON escape text", async () => {
  const title = "x".repeat(16383) + "𐃿�\\udcff\"";
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { tags: { title } });
  const result = await run(bytes, "json=sv=fail", true);
  expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.toString()).format.tags.title).toBe(title);
});

it("escapes a custom replacement as metadata and preserves a literal replacement character", async () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { tags: { title: "aX�b" } });
  bytes[Buffer.from(bytes).indexOf("aX�b") + 1] = 0xff;
  const result = await run(bytes, 'json=svr=日本"\\=:sv=replace');
  expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.toString()).format.tags.title).toBe('a日本"\\=�b');
});

it("retains other selected tags after rejecting an invalid tag", async () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { tags: { title: "aXb", artist: "Valid" } });
  bytes[Buffer.from(bytes).indexOf("aXb") + 1] = 0xff;
  const result = await run(bytes, "json=sv=fail", false, false, "format_tags");
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout.toString())).toEqual({ format: { tags: { artist: "Valid" } } });
});

for (const writer of ["default", "compact", "csv", "flat", "ini", "xml", "json=c=1"]) {
  for (const mode of ["ignore", "fail"]) it(`honors ${mode} with ${writer}`, async () => {
    const result = await run(bad, writer + (writer.includes("=") ? ":" : "=") + `sv=${mode}`);
    expect(result.exitCode).toBe(mode === "fail" ? 1 : 0);
    expect(result.stdout.includes(Buffer.from([0x61, 0xff, 0x62]))).toBe(mode === "ignore");
    if (mode === "fail") expect(result.stderr).toContain("Invalid UTF-8");
    else expect(result.stderr).toBe("");
  });
}

for (const explicit of [false, true]) for (const mode of ["replace", "ignore", "fail"]) {
  it(`honors ${mode} for inline WAV (${explicit ? "explicit" : "detected"})`, async () => {
    const result = await run(bad, `json=sv=${mode}:svr=?`, "inline", explicit);
    expect(result.exitCode).toBe(mode === "fail" ? 1 : 0);
    if (mode === "ignore") expect(result.stdout.includes(Buffer.from([0x61, 0xff, 0x62]))).toBe(true);
    else expect(JSON.parse(result.stdout.toString())).toEqual({ format: { tags: mode === "fail" ? {} : { title: "a?b" } } });
  });
}
