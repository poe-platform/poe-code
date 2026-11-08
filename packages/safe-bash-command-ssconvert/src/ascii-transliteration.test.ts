import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { toByteSource } from "safe-bash-contracts/io";
import { createSsconvertCommand } from "./commands.js";
import { csvFormat } from "./index.js";

// The target is Gnumeric 1.12.61 with the captured glibc converter profile.
// Escape mode preserves scalar identities; transliteration follows that profile.
it.each([
  ["C", "transliterate", "?\n?\n?\n?\n?\nEUR\nss\n"],
  ["C.UTF-8", "transliterate", "?\n?\n?\n:-D\n?\nEUR\nss\n"],
  ["C", "escape", "\\u6f22\n\\u6771\n\\u4eac\n\\U0001f600\n\\u301c\n\\u20ac\n\\u00df\n"],
  ["C.UTF-8", "escape", "\\u6f22\n\\u6771\n\\u4eac\n\\U0001f600\n\\u301c\n\\u20ac\n\\u00df\n"]
])("exports Unicode with the pinned %s ASCII %s profile", async (locale, mode, expected) => {
  const fs = createMemoryFileSystem();
  const input = new TextEncoder().encode("漢\n東\n京\n😀\n〜\n€\nß\n");
  await fs.writeFile("/input.csv", input);
  const args = createCommandArguments(["-E", "UTF-8", "-I", "Gnumeric_stf:stf_csvtab",
    "-T", "Gnumeric_stf:stf_assistant", "-O", `charset=ASCII transliterate-mode=${mode}`,
    "/input.csv", "/output.txt"]);
  const errors: string[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const context: CommandContext = { command: "ssconvert", args: args.args, argumentValues: args,
    cwd: "/", env: { LC_ALL: locale }, fs, signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); } };
  try {
    expect(await createSsconvertCommand({ formats: [csvFormat] }).execute(context), errors.join(""))
      .toMatchObject({ exitCode: 0 });
    expect(errors).toEqual([]);
    expect(await fs.readFile("/output.txt"))
      .toEqual(new TextEncoder().encode(expected));
    expect(await fs.readFile("/input.csv")).toEqual(input);
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
});
