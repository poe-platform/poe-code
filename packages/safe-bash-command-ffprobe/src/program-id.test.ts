import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("./fixtures/programs.mpegts", import.meta.url));

for (const [section, field] of [["stream", "index"], ["packet", "stream_index"]] as const) {
  // Native ffprobe: -select_streams SELECTOR -show_entries SECTION=FIELD -of json.
  it.each([
    ["p:202", [1]], ["p:0312", [1]], ["p:0101", []],
    ["p:0xca", [1]], ["p:0XCA", [1]], ["p:+202", [1]],
    ["p:+0312", [1]], ["p:+0xca", [1]], ["p:101", [0]], ["p:999", []],
  ] as const)(`selects ${section} rows by program ID %s in streaming and sync commands`, async (selector, indices) => {
    const args = ["-v", "error", "-select_streams", selector, "-show_entries", `${section}=${field}`, "-of", "json", "/input.ts"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.ts", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
      const rows = JSON.parse(text)[`${section}s`] as Record<string, number>[];
      expect([...new Set(rows.map(row => row[field]))]).toEqual(indices);
    }
  });

  it.each(["p:08", "p:+08", "p:0x", "p:0xgg", "p:+", "p:++202", "p:202junk"])(
    `rejects malformed program ID %s before publishing ${section} rows`, async selector => {
      const args = ["-v", "error", "-select_streams", selector, "-show_entries", `${section}=${field}`, "-of", "json", "/input.ts"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.ts", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode).toBe(1);
      expect(diagnostic).toContain(`Invalid stream specifier: ${selector}`);
      expect(output).toBe("");
      expect(evalSyncFfprobe(undefined, args, () => bytes)).toBeUndefined();
    }
  );
}
