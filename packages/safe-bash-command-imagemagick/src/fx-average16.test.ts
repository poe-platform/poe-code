import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const grid = ["(", "xc:black", "xc:red", "+append", ")", "(", "xc:lime", "xc:blue", "+append", ")", "-append"];
const row = ["xc:black", "xc:red", "xc:lime", "xc:blue", "+append"];
// ImageMagick 7.1.2-35 Q16-HDRI reference output for the reported sampling paths.
const cases = [
    { name: "formatted fractional pixels", input: grid, options: ["-interpolate", "average16", "-format", "%[hex:p{0.25,0.6}]|%[hex:p{0.5,0.5}]|%[fx:p{0.25,0.6}.r]", "info:"], text: "400040004000|400040004000|0.25" },
    { name: "FX fractional pixels", input: grid, options: ["-interpolate", "average16", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "404040ff".repeat(4) },
    { name: "four-column footprint", input: row, options: ["-interpolate", "average16", "-format", "%[hex:p{1.25,0}]", "info:"], text: "400040004000" },
    { name: "average4 control", input: row, options: ["-interpolate", "average4", "-format", "%[hex:p{1.25,0}]", "info:"], text: "800080000000" },
    { name: "bilinear FX control", input: grid, options: ["-interpolate", "bilinear", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "1a7326ff".repeat(4) },
    { name: "reset interpolation", input: grid, options: ["-interpolate", "average16", "+interpolate", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "1a7326ff".repeat(4) },
    // The neighborhood starts at floor(x/y)-1, including integer and negative coordinates.
    { name: "integer coordinates still average", input: row, options: ["-interpolate", "average16", "-format", "%[hex:p{1,0}]|%[fx:p{1,0}.intensity]", "info:"], text: "400040004000|0.25" },
    { name: "negative edge coordinates", input: row, options: ["-interpolate", "average16", "-format", "%[hex:p{-0.25,0}]", "info:"], text: "400000000000" },
    { name: "tiled virtual pixels", input: row, options: ["-virtual-pixel", "tile", "-interpolate", "average16", "-format", "%[hex:p{-0.25,0}]", "info:"], text: "400040004000" },
    { name: "transparent colors do not bleed", input: ["xc:#ff000000", "xc:blue", "+append"], options: ["-interpolate", "average16", "-fx", "p{0.5,0}", "-depth", "8", "rgba:-"], hex: "00008080".repeat(2) },
    { name: "translucent colors have equal weight", input: ["xc:#ff000080", "xc:#0000ff40", "+append"], options: ["-interpolate", "average16", "-fx", "p{0.5,0}", "-depth", "8", "rgba:-"], hex: "80008060".repeat(2) },
    { name: "fully transparent footprint", input: ["xc:#ff000000"], options: ["-interpolate", "average16", "-fx", "p{0,0}", "-depth", "8", "rgba:-"], hex: "00000000" },
    { name: "16-bit samples retain precision", input: ["xc:#123456789abc"], options: ["-interpolate", "average16", "-format", "%[hex:p{0,0}]", "info:"], text: "123456789ABC" },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async fixture => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = [...fixture.input, ...fixture.options], chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toMatchObject({ exitCode: 0 });
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(output.toString(fixture.hex === undefined ? "utf8" : "hex")).toBe(fixture.hex ?? fixture.text);
    });
}
