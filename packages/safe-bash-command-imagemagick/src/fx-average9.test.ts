import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const grid = ["(", "xc:black", "xc:red", "+append", ")", "(", "xc:lime", "xc:blue", "+append", ")", "-append"];
// Fractional samples match ImageMagick 7.1.2-35 Q16-HDRI reference output.
const cases = [
    { name: "formatted fractional pixels", input: grid, options: ["-format", "%[hex:p{0.25,0.6}]|%[hex:p{0.5,0.5}]|%[fx:p{0.25,0.6}.r]", "info:"], text: "1C7271C738E3|38E338E371C7|0.111111" },
    { name: "FX fractional pixels", input: grid, options: ["-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "1c7139ff".repeat(4) },
    { name: "three-pixel footprint", input: ["xc:black", "xc:red", "xc:lime", "xc:blue", "+append"], options: ["-format", "%[hex:p{1.25,0}]", "info:"], text: "555555550000" },
    { name: "integer coordinates still average neighbors", input: grid, options: ["-format", "%[hex:p{0,0}]", "info:"], text: "38E338E31C72" },
    { name: "tiled virtual pixels", input: grid, options: ["-virtual-pixel", "tile", "-format", "%[hex:p{0,0}]", "info:"], text: "38E338E371C7" },
    { name: "alpha-weighted colors", input: ["xc:red", "xc:#0000ff00", "+append"], options: ["-channel", "RGBA", "-fx", "p{0.25,0}", "-depth", "8", "rgba:-"], hex: "ff0000aa".repeat(2) },
    { name: "fully transparent neighbors", input: ["xc:#ff000000"], options: ["-channel", "RGBA", "-fx", "p{0,0}", "-depth", "8", "rgba:-"], hex: "00000000" },
    { name: "average4 control", input: ["xc:black", "xc:red", "xc:lime", "xc:blue", "+append"], options: ["-interpolate", "average4", "-format", "%[hex:p{1.25,0}]", "info:"], text: "800080000000" },
    { name: "bilinear reset", input: grid, options: ["+interpolate", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "1a7326ff".repeat(4) },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async fixture => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = [...fixture.input, "-interpolate", "average9", ...fixture.options], chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(output.toString(fixture.hex === undefined ? "utf8" : "hex")).toBe(fixture.hex ?? fixture.text);
    });
}
