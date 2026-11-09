import { readFile } from "node:fs/promises";
import { writeAudioMetadata } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { SourceAudioTags } from "./source-tags.js";

async function tags(bytes: Uint8Array, route: "file" | "stdin" | "sync") {
  const args = ["-v", "error", "-show_streams", "-show_format", "-of", "json", route === "stdin" ? "-" : "/input.mp3"];
  if (route === "sync") return JSON.parse(evalSyncFfprobe(bytes, args, () => bytes)!).format.tags;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.mp3", bytes);
  let output = "", error = "";
  const decoder = new TextDecoder();
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += decoder.decode(chunk, { stream: true }); } },
    stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
  });
  output += decoder.decode();
  expect(error).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(output).format.tags;
}

for (const route of ["file", "stdin", "sync"] as const) {
  for (const version of [3, 4]) {
    it(`preserves native ID3v2.${version} user text tags via ${route}`, async () => {
      const bytes = await readFile(new URL(`./fixtures/user-text-v${version}.mp3`, import.meta.url));
      expect(await tags(bytes, route)).toEqual({
        title: "Control", audit_note: "Take2", REPLAYGAIN_TRACK_GAIN: "-4.50 dB",
        REPLAYGAIN_TRACK_PEAK: "0.750000", encoder: "Lavf61.1.100"
      });
    });
  }
  it(`leaves the untagged native MP3 without format tags via ${route}`, async () => {
    const bytes = await readFile(new URL("./fixtures/user-text-flat.mp3", import.meta.url));
    expect(await tags(bytes, route)).toBeUndefined();
  });
  it(`keeps arbitrary user text keys distinct via ${route}`, async () => {
    const audio = new Uint8Array(417 * 3);
    for (let at = 0; at < audio.length; at += 417) audio.set([255, 251, 144, 0], at);
    const expected = {
      custom: "lower", CUSTOM: "upper", "a_b-c": "punctuation", "a?bMc": "distinct",
      ["日本😀".repeat(5000)]: "long Unicode key", "": "empty key", "123": "numeric key"
    };
    const actual = await tags(writeAudioMetadata(audio, expected), route);
    for (const [key, value] of Object.entries(expected)) expect(actual[key]).toBe(value);
    expect(Object.keys(actual).length).toBe(Object.keys(expected).length);
  });
}

it("preserves colliding keys and replaces duplicate values without changing insertion order", async () => {
  const fs = new MemoryFileSystem();
  const index = new SourceAudioTags({ size: 0, async read() { throw new Error("unexpected source read"); } }, {
    fs, cwd: "/", env: {}, signal: new AbortController().signal
  });
  try {
    // These distinct names have the same FNV-1a hash.
    await index.add({ key: "costarring", value: "first" });
    await index.add({ key: "liquid", value: "second" });
    await index.add({ key: "costarring", value: "updated" });
    const actual: [string, string][] = [];
    for await (const entry of index.entries()) {
      let value = "";
      for await (const part of entry.text()) value += part;
      actual.push([entry.key, value]);
    }
    expect(index.count).toBe(2);
    expect(actual).toEqual([["costarring", "updated"], ["liquid", "second"]]);
  } finally { await index.close(); }
  expect(await fs.readdir("/")).toEqual([]);
});
