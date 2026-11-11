import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, before any GIF encoding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: ["xc:red", "xc:blue"], operations: ["-layers", "Optimize", "-cycle", "1"], expected: "0000ffff0000" },
        { input: ["xc:red", "xc:blue"], operations: ["-layers", "OptimizeFrame", "-cycle", "1"], expected: "ff00000000ff" },
        { input: ["xc:red", "xc:blue"], operations: [], expected: "ff00000000ff" },
        { input: ["xc:red", "xc:blue"], operations: ["-layers", "Optimize"], info: true, expected: "PseudoClass sRGB |1;PseudoClass sRGB Alpha|1;" },
        { input: ["-size", "300x1", "gradient:black-white", "gradient:red-blue"], operations: ["-layers", "Optimize"], info: true, expected: "PseudoClass sRGB |32;PseudoClass sRGB Alpha|42;" },
        { input: ["-size", "300x1", "gradient:black-white", "gradient:red-blue"], operations: ["+dither", "-layers", "Optimize"], info: true, expected: "PseudoClass sRGB |64;PseudoClass sRGB Alpha|66;" },
        { input: ["xc:red"], operations: ["-layers", "Optimize"], info: true, expected: "PseudoClass sRGB |1;" },
        { input: ["(", "xc:red", "xc:blue", "-layers", "Optimize", ")"], operations: ["-cycle", "1"], expected: "0000ffff0000" },
        { input: ["xc:red", "xc:blue", "xc:lime"], operations: ["-layers", "Optimize", "-cycle", "1"], expected: "00ff00ff00000000ff" },
        { input: ["xc:red", "xc:blue"], operations: ["-layers", "Optimize", "-cycle", "1", "-cycle", "-1"], expected: "ff00000000ff" },
        { input: ["-size", "300x1", "gradient:black-white", "gradient:red-blue"], operations: ["-layers", "OptimizeFrame"], info: true, expected: "DirectClass sRGB |300;DirectClass sRGB |300;" },
    ])(`${mode}: $input $operations (info=$info)`, async ({ input, operations, info, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [...input, ...operations, ...(info ? ["-format", "%r|%k;", "info:/out"] : ["-depth", "8", "rgb:/out"])];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr += result.stderr;
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(info ? "utf8" : "hex")).toBe(expected);
    });
}
