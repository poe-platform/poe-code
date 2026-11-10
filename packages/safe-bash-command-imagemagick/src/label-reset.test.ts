import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "magick", "convert"] as const) {
    it.each([
        { name: "clears a pending label", input: ["-label", "one", "+label", "xc:red"], expected: ";" },
        { name: "accepts a reset without a pending label", input: ["+label", "xc:red"], expected: ";" },
        { name: "retains an active label", input: ["-label", "one", "xc:red"], expected: "one;" },
        { name: "leaves unlabeled input unchanged", input: ["xc:red"], expected: ";" },
        { name: "preserves labels on earlier frames", input: ["-label", "one", "xc:red", "+label", "xc:blue"], expected: "one;;" },
        { name: "accepts a new label after resetting", input: ["-label", "one", "+label", "-label", "two", "xc:red"], expected: "two;" }
    ])(`${mode}: $name`, async ({ input, expected }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const args = [...input, "-format", "%l;", "info:/out"];
        let stdout = "", stderr = "";
        const result = mode === "buffered" ? runMagickCliSync(args, files) : {
            ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        };
        expect.soft(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
