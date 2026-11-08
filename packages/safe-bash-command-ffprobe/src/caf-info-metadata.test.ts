import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

it("exposes independently packed CAF info entries as format tags", async () => {
  // 8000 Hz mono LPCM with a two-entry info dictionary, without using the CAF writer.
  const bytes = Buffer.from(
    "636166660001000064657363000000000000002040bf4000000000006c70636d0000000000000002000000010000000100000010" +
    "696e666f000000000000001d000000027469746c65004576656e696e6700617274697374004b617900" +
    "64617461000000000000000c000000000064ff38012cfe70", "hex");
  const args = ["-v", "error", "-show_entries", "format_tags", "-of", "json", "/in.caf"];
  const expected = { format: { tags: { title: "Evening", artist: "Kay" } } };
  expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toEqual(expected);

  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.caf", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(JSON.parse(output)).toEqual(expected);
  expect(await fs.readFile("/in.caf")).toEqual(new Uint8Array(bytes));
});
