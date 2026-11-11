import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: magick icon.xpm -depth 8 rgba:-.
it.each([
  ["a", "bebebeff0000ffff00000000"],
  ["a C red", "bebebeff0000ffff00000000"],
  ["a c red", "ff0000ff0000ffff00000000"],
  ["a c no_such_named_color", null]
] as const)("handles XPM palette fields through the magick command: %s", async (entry, expected) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/icon.xpm", new TextEncoder().encode(`/* XPM */
static char *icon[] = {
"3 1 3 1",
"${entry}",
"b c blue",
". c None",
"ab."
};`));
  const command = createMagickCommand();
  const argumentValues = createCommandArguments(["icon.xpm", "-depth", "8", "rgba:-"]);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += Buffer.from(bytes).toString("hex"); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode).toBe(expected === null ? 1 : 0);
  expect(stdout).toBe(expected ?? "");
  if (expected === null) expect(stderr).toContain("Invalid XPM color");
  else expect(stderr).toBe("");
});
