import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const grid = ["(", "xc:black", "xc:red", "+append", ")", "(", "xc:lime", "xc:blue", "+append", ")", "-append"];
const translucent = ["xc:#ff000080", "xc:#0000ff40", "+append"];
// ImageMagick 7.1.2-35 Q16-HDRI reference output.
const cases = [
    { name: "formatted fractional pixels", input: grid, options: ["-interpolate", "spline", "-format", "%[hex:p{0.25,0.6}]|%[hex:p{0.5,0.5}]|%[fx:p{0.25,0.6}.r]", "info:"], text: "229864602EBD|400040004000|0.135132" },
    { name: "FX fractional pixels", input: grid, options: ["-interpolate", "spline", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "22642fff".repeat(4) },
    // At the corner, edge-clamped spline weights yield R=G=5/36 and B=1/36.
    { name: "integer coordinates still smooth", input: grid, options: ["-interpolate", "spline", "-fx", "p{0,0}", "-depth", "8", "rgba:-"], hex: "232307ff".repeat(4) },
    { name: "translucent FX retains premultiplied colors", input: translucent, options: ["-interpolate", "spline", "-fx", "p{0.5,0}", "-depth", "8", "rgba:-"], hex: "40002060".repeat(2) },
    { name: "bilinear FX control", input: grid, options: ["-interpolate", "bilinear", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "1a7326ff".repeat(4) },
    { name: "translucent resize", input: translucent, options: ["-interpolate", "spline", "-interpolative-resize", "3x1!", "-depth", "8", "rgba:-"], hex: "7400067a400020600c003a46" },
    { name: "bilinear resize control", input: translucent, options: ["-interpolate", "bilinear", "-interpolative-resize", "3x1!", "-depth", "8", "rgba:-"], hex: "ff000080aa0055600000ff40" },
    { name: "reset spline resize", input: translucent, options: ["-interpolate", "spline", "+interpolate", "-interpolative-resize", "3x1!", "-depth", "8", "rgba:-"], hex: "ff000080aa0055600000ff40" },
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
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes ? result.stdoutBytes : "stdout" in result ? result.stdout : "");
        expect(output.toString(fixture.hex === undefined ? "utf8" : "hex")).toBe(fixture.hex ?? fixture.text);
    });
}
