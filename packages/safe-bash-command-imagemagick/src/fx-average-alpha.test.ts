import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const translucent = ["xc:#ff000080", "xc:#0000ff40", "+append"];
// ImageMagick 7.1.2-35 Q16-HDRI reference output.
const cases = [
    { name: "translucent FX colors have equal weight", input: translucent, options: ["-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "80008060".repeat(2) },
    { name: "formatted pixels and FX use the same average", input: translucent, options: ["-format", "%[hex:p{0.25,0}]|%[fx:p{0.25,0}.r]", "info:"], text: "8000000080006060|0.5" },
    { name: "opaque FX control", input: ["xc:red", "xc:blue", "+append"], options: ["-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "800080ff".repeat(2) },
    { name: "bilinear preserves opacity weighting", input: translucent, options: ["-interpolate", "bilinear", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:-"], hex: "db002470".repeat(2) },
    { name: "average resize control", input: translucent, options: ["-interpolative-resize", "3x1!", "-depth", "8", "rgba:-"], hex: "ff000080800080600000ff40" },
    { name: "transparent colors contribute zero without renormalizing", input: ["xc:red", "xc:#0000ff00", "+append"], options: ["-channel", "RGBA", "-fx", "p{0.25,0}", "-depth", "8", "rgba:-"], hex: "80000080".repeat(2) },
    { name: "fully transparent colors contribute zero", input: ["xc:#ff000000"], options: ["-channel", "RGBA", "-fx", "p{0,0}", "-depth", "8", "rgba:-"], hex: "00000000" },
];
for (const method of ["average", "average4"]) {
    for (const mode of ["command", "retained", "buffered", "sync"] as const) {
        it.each(cases)(`${method}, ${mode}: $name`, async fixture => {
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = [...fixture.input, "-interpolate", method, ...fixture.options], chunks: Uint8Array[] = [];
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
                : Buffer.from("stdoutBytes" in result && result.stdoutBytes ? result.stdoutBytes : "stdout" in result ? result.stdout : "");
            expect(output.toString(fixture.hex === undefined ? "utf8" : "hex")).toBe(fixture.hex ?? fixture.text);
        });
    }
}
