import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI XPM reader output, including its
// direct use of CMY as RGB components rather than a CMYK-to-RGB conversion.
const cases = [
  ["hsv(180,50%,50%)", 8, "408080ff"],
  ["cmyk(0%,100%,100%,0%)", 8, "00ffffff"],
  ["hsl(180,50%,50%)", 8, "40bfbfff"],
  ["srgb(0%,50%,100%)", 8, "0080ffff"],
  ["hsv(180,50%,50%)", 16, "400080008000ffff"],
  ["hsv(60,100%,50%)", 16, "800080000000ffff"],
  ["hsv(120,100%,50%)", 16, "000080000000ffff"],
  ["hsv(240,100%,50%)", 16, "000000008000ffff"],
  ["hsv(300,100%,50%)", 16, "800000008000ffff"],
  ["hsv(0,0%,50%)", 16, "800080008000ffff"],
  ["hsv(420,50%,50%)", 16, "800080004000ffff"],
  ["hsv(-60,50%,50%)", 16, "800040008000ffff"],
  ["hsv(180,50,50)", 16, "285a32323232ffff"],
  ["hsv(50%,50%,50%)", 16, "400080004800ffff"],
  ["cmyk(10%,20%,30%,90%)", 16, "199a33334ccdffff"],
  ["cmyk(25.5,51,76.5,229.5)", 16, "199a33334ccdffff"]
] as const;

for (const mode of ["command", "sync", "buffered", "retained"] as const) {
  it.each(cases)(`decodes functional XPM color %s at depth %s (${mode})`, async (color, depth, pixel) => {
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
    const argv = ["/icon.xpm", "-depth", String(depth), ...(depth === 16 ? ["-endian", "MSB"] : []), "rgba:-"];
    const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files)
      : mode === "buffered" ? await runMagickCli(argv, files)
      : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
      : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
    expect(result.exitCode, stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(pixel + (depth === 8 ? "0000ffff00000000" : "00000000ffffffff0000000000000000"));
  });
}
