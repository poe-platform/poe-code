import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA (big-endian at depth 16).
const cases = [
    { name: "translucent", input: ["xc:#80402080", "xc:#204080c0"], operation: ["-coalesce"],
        rgba8: "804020802e4072e0", rgba16: "80804040202080802dc1404072dfe07f" },
    { name: "layers alias", input: ["xc:#80402080", "xc:#204080c0"], operation: ["-layers", "Coalesce"],
        rgba8: "804020802e4072e0", rgba16: "80804040202080802dc1404072dfe07f" },
    { name: "uncomposited", input: ["xc:#80402080", "xc:#204080c0"], operation: [],
        rgba8: "80402080204080c0", rgba16: "8080404020208080202040408080c0c0" },
    { name: "16-bit source", input: ["xc:#123456789abc8000", "xc:none"], operation: ["-coalesce"],
        rgba8: "12569a8012569a80", rgba16: "123456789abc8000123456789abc8000" },
    { name: "previous disposal", input: ["xc:#80402080", "-dispose", "Previous", "xc:#204080c0", "-dispose", "None", "xc:#204080c0"], operation: ["-coalesce"],
        rgba8: "804020802e4072e02e4072e0", rgba16: "80804040202080802dc1404072dfe07f2dc1404072dfe07f" },
    { name: "background disposal", input: ["xc:#80402080", "-dispose", "Background", "xc:#204080c0", "-dispose", "None", "xc:#204080c0"], operation: ["-coalesce"],
        rgba8: "804020802e4072e0204080c0", rgba16: "80804040202080802dc1404072dfe07f202040408080c0c0" },
    { name: "opaque", input: ["xc:red", "xc:blue"], operation: ["-coalesce"],
        rgba8: "ff0000ff0000ffff", rgba16: "ffff00000000ffff00000000ffffffff" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each(cases)(`${mode}, depth ${depth}: $name`, async ({ input, operation, rgba8, rgba16 }) => {
            const argv = [...input, ...operation, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
            const files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
                fs: new MemoryFileSystem(), signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(bytes).toString("hex")).toBe(depth === 8 ? rgba8 : rgba16);
        });
    }
}
