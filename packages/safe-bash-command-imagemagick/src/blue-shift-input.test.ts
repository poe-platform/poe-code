import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the operator requires an image already on the stack.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "before the first image", operands: ["-blue-shift", "1.5", "xc:#4080a080"], exitCode: 1, hex: "4b454550" },
        { name: "after deleting the last image", operands: ["xc:red", "+delete", "-blue-shift", "1.5", "xc:#4080a080"], exitCode: 1, hex: "4b454550" },
        { name: "after the image", operands: ["xc:#4080a080", "-blue-shift", "1.5"], exitCode: 0, hex: "a0b0b880" },
    ])(`${mode}: blue-shift $name`, async ({ operands, exitCode, hex }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out.raw", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out.raw", original);
        const argv = ["-define", "filename:literal=true", ...operands, "-depth", "8", "rgba:out.raw"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode, result.stderr).toBe(exitCode);
        expect.soft(result.stdout).toBe("");
        if (exitCode) expect.soft(result.stderr).toContain("no images found for operation '-blue-shift'");
        else expect.soft(result.stderr).toBe("");
        const output = mode === "sync" || mode === "buffered" ? files.get("out.raw")! : await fs.readFile("/out.raw");
        expect.soft(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
