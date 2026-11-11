import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
  // ImageMagick 7.1.2-35 Q16-HDRI selects the first field at the highest priority.
  it.each([
    ["c red c blue", [255, 0, 0, 255]],
    ["m blue m red", [0, 0, 255, 255]],
    ["g blue g red", [0, 0, 255, 255]],
    ["g4 blue g4 red", [0, 0, 255, 255]],
    ["s red s blue", [255, 0, 0, 255]],
    ["g blue c red", [255, 0, 0, 255]],
    ["c red g blue c blue", [255, 0, 0, 255]],
    ["c None c red", [0, 0, 0, 0]],
    ["c red c None", [255, 0, 0, 255]]
  ] as const)(`uses the first repeated XPM field (${mode}): %s`, async (fields, pixel) => {
    const input = new TextEncoder().encode(`/* XPM */
static char *icon[] = {
"3 1 3 1",
"a ${fields}",
"b c blue",
". c None",
"ab."
};`);
    const files = new Map([["/icon.xpm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/icon.xpm", input);
    const args = ["/icon.xpm", "-depth", "8", "rgba:-"];
    const argumentValues = createCommandArguments(args);
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "public" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout.push(...bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdoutBytes" in result ? result.stdoutBytes : Uint8Array.from(stdout)).toEqual(
      Uint8Array.from([...pixel, 0, 0, 255, 255, 0, 0, 0, 0])
    );
  });
}
