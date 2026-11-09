import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe: pcm_s16be, [0][0][0][0], 0x0000 for this ordinary AIFF.
const bytes = Buffer.from("464f524d0000003841494646434f4d4d000000120001000000050010400bfa0000000000000053534e44000000120000000000000000000bff2b0bb80001fff7", "hex");
const args = ["-v", "error", "-show_entries", "stream=codec_name,codec_tag_string,codec_tag", "-of", "json"];
const expected = { codec_name: "pcm_s16be", codec_tag_string: "[0][0][0][0]", codec_tag: "0x0000" };

it.each(["/plain.aiff", "-"])("reports no codec tag for ordinary AIFF from %s", async target => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/plain.aiff", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([...args, target]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(diagnostic).toBe("");
  expect(JSON.parse(output).streams).toEqual([expected]);
});

it("reports no ordinary AIFF codec tag through the synchronous command", () => {
  const output = evalSyncFfprobe(bytes, [...args, "plain.aiff"], () => bytes);
  expect(output).toBeDefined();
  expect(JSON.parse(output!).streams).toEqual([expected]);
});
