import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const grid = ["(", "xc:black", "xc:red", "+append", ")", "(", "xc:lime", "xc:blue", "+append", ")", "-append"];
const translucent = ["xc:#ff000080", "xc:#0000ff40", "+append"];
// ImageMagick 7.1.2-35 Q16-HDRI reference output; inputs are generated inline.
const cases = [
  { name: "formatted pixels and FX", input: grid, options: ["-interpolate", "catrom", "-format", "%[hex:p{0.25,0.6}]|%[hex:p{0.5,0.5}]|%[fx:p{0.25,0.6}.r]", "info:"], text: "138D7F4B2073|400040004000|0.076375" },
  { name: "FX pixels", input: grid, options: ["-interpolate", "catrom", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:/out"], hex: "137f20ff".repeat(4) },
  { name: "Q16 FX pixels", input: grid, options: ["-interpolate", "catrom", "-fx", "p{0.25,0.6}", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "138d7f4b2073ffff".repeat(4) },
  { name: "bilinear FX control", input: grid, options: ["-interpolate", "bilinear", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:/out"], hex: "1a7326ff".repeat(4) },
  { name: "interpolation reset", input: grid, options: ["-interpolate", "catrom", "+interpolate", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:/out"], hex: "1a7326ff".repeat(4) },
  { name: "translucent resize", input: translucent, options: ["-interpolate", "catrom", "-interpolative-resize", "3x1!", "-depth", "8", "rgba:/out"], hex: "87000084400020600000443c" },
  { name: "bilinear resize control", input: translucent, options: ["-interpolate", "bilinear", "-interpolative-resize", "3x1!", "-depth", "8", "rgba:/out"], hex: "ff000080aa0055600000ff40" },
  { name: "translucent FX", input: translucent, options: ["-interpolate", "catrom", "-fx", "p{0.5,0}", "-depth", "8", "rgba:/out"], hex: "aa005560".repeat(2) },
  { name: "translucent FX channels", input: translucent, options: ["-interpolate", "catrom", "-format", "%[fx:p{0,0}.r]|%[fx:p{0.5,0}.r]|%[fx:p{0.5,0}.b]|%[fx:p{0.5,0}.a]|%[fx:p{0,0}.intensity]|%[fx:p{0.25,0}.intensity]|%[fx:p{0.5,0}.hue]|%[fx:p{0.5,0}.saturation]|%[fx:p{0.5,0}.lightness]", "info:"], text: "1|0.666667|0.333333|0.376471|0.106745|0.0887425|0.916667|1|0.333333" },
  { name: "tile virtual pixels", input: grid, options: ["-interpolate", "catrom", "-virtual-pixel", "tile", "-format", "%[hex:p{-0.25,1.6}]", "info:"], text: "19EB4C080E14" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each(cases)(`${mode}: matches native Catrom $name`, async ({ input, options, text, hex }) => {
    const args = [...input, ...options], files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result, stderr).toMatchObject({ exitCode: 0 });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    if (text !== undefined) expect("stdout" in result ? result.stdout : stdout).toBe(text);
    if (hex !== undefined) expect(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(hex);
  });
}
