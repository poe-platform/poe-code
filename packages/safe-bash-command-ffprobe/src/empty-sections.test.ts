import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const bytes = Uint8Array.from(Buffer.from(
  "524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000",
  "hex"
));

for (const target of ["/input.wav", "-"]) {
  const size = target === "-" ? "N/A" : "86";
  it.each([
    [":format=size", undefined],
    ["format=size::stream=index", undefined],
    ["format=size::", undefined],
    [":", undefined],
    ["", ""],
    ["format=size:", `[FORMAT]\nsize=${size}\n[/FORMAT]\n`],
    ["format=size:stream=index", `[STREAM]\nindex=0\n[/STREAM]\n[FORMAT]\nsize=${size}\n[/FORMAT]\n`],
    ["format=size:stream=index:", `[STREAM]\nindex=0\n[/STREAM]\n[FORMAT]\nsize=${size}\n[/FORMAT]\n`]
  ] as const)(`preserves empty section rules via ${target}: %j`, async (entries, expected) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    let stdout = "", stderr = "";
    const args = ["-v", "error", "-of", "default", "-show_entries", entries, target];
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode).toBe(expected === undefined ? 1 : 0);
    expect(stdout).toBe(expected ?? "");
    expect(stderr).toBe(expected === undefined
      ? `ffprobe: No match for section ''\nFailed to set value '${entries}' for option 'show_entries': Invalid argument\n`
      : "");
    expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(expected);
  });
}
