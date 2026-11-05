import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { toByteSource } from "safe-bash-contracts/io";
import { createSsconvertCommand } from "./commands.js";
import { csvFormat } from "./index.js";

it.each([
  [[0x8a, 0xbf, 0x8e, 0x9a, 10], "漢字\n"],
  [[0xa6, 0xb1, 10], "ｦｱ\n"],
  [[0x5c, 0x7e, 0x81, 0x60, 10], "¥‾〜\n"],
  [[0x8a, 0xbf, 0x8e], "漢\n"],
  [[0x8a, 0xbf, 0x81, 0x20, 10], '"\u008a¿\u0081 "\n'],
  [[0x87, 0x40, 10], "\u0087@\n"],
  [[0xc3, 0xa9, 0xff, 10], "Ã©ÿ\n"]
] as const)("imports Shift-JIS CSV bytes %j through the command", async (payload, expected) => {
  const fs = createMemoryFileSystem();
  const prefix = new TextEncoder().encode("Name,Value\nTokyo,");
  const input = new Uint8Array([...prefix, ...payload]);
  await fs.writeFile("/input.csv", input);
  const args = createCommandArguments(["-E", "SHIFT_JIS", "-I", "Gnumeric_stf:stf_csvtab",
    "-T", "Gnumeric_stf:stf_csv", "/input.csv", "/output.csv"]);
  const errors: string[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const context: CommandContext = { command: "ssconvert", args: args.args, argumentValues: args,
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); } };
  try {
    const result = await createSsconvertCommand({ formats: [csvFormat] }).execute(context);
    expect(result, errors.join("")).toMatchObject({ exitCode: 0 });
    expect(errors).toEqual([]);
    expect(await fs.readFile("/output.csv")).toEqual(new TextEncoder().encode("Name,Value\nTokyo," + expected));
    expect(await fs.readFile("/input.csv")).toEqual(input);
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
});
