import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
  // ImageMagick 7.1.2-35 Q16-HDRI canonicalizes names and hexadecimal spelling.
  it.each([
    ["red", "red", [255, 0, 0]],
    ["#ff0000", "red", [255, 0, 0]],
    ["#1a2b3c", "#1A2B3C", [26, 43, 60]],
    ["#F0F8FF", "AliceBlue", [240, 248, 255]],
    ["gray0", "black", [0, 0, 0]],
    ["gray100", "white", [255, 255, 255]],
    ["gray41", "DimGray", [105, 105, 105]],
    ["WhiteSmoke", "gray96", [245, 245, 245]],
    ["NavyBlue", "navy", [0, 0, 128]],
    ["green", "green", [0, 255, 0]],
    ["gray", "gray", [190, 190, 190]],
    ["purple", "purple", [160, 32, 240]],
    ["MediumGoldenrod", "MediumGoldenRod", [209, 193, 102]],
  ] as const)(`writes native XPM palette spellings (${mode}): %s`, async (color, spelling, rgb) => {
    const input = new TextEncoder().encode(`/* XPM */
static char *icon[] = {
"3 1 3 1",
"a c ${color}",
"b c blue",
". c None",
"ab."
};`);
    const files = new Map([["/icon.xpm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/icon.xpm", input);
    const args = ["/icon.xpm", "xpm:-"], argumentValues = createCommandArguments(args);
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
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    const strings = new TextDecoder().decode(bytes).split("\n")
      .filter(line => line.startsWith('"')).map(line => line.slice(1, line.lastIndexOf('"')));
    expect(strings[0]!.trim()).toBe("3 1 3 1");
    expect(strings.slice(1, 4).map(line => line.slice(4)).sort()).toEqual(["None", spelling, "blue"].sort());
    expect(decodeImage(bytes).data).toEqual(Uint8Array.from([...rgb, 255, 0, 0, 255, 255, 0, 0, 0, 0]));
  });
}
