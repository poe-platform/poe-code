import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI consumes the plus operand but always uses 1.5.
describe.each(["command", "retained", "buffered", "sync"] as const)("+blue-shift (%s)", mode => {
    it.each([
        ...["0", "1", "2", "abc", "", "%[fx:1/0]"].map(operand => ({ option: "+blue-shift", operand, expected: "98a9ba" })),
        { option: "-blue-shift", operand: "1.5", expected: "98a9ba" },
        { option: "-blue-shift", operand: "1", expected: "68798a" },
    ])("$option $operand consumes its operand and produces $expected", async ({ option, operand, expected }) => {
        for (const input of [["xc:#2468ac"], ["-size", "1x1", "-depth", "8", "rgb:input.rgb"]]) {
            const files = new Map([["input.rgb", Uint8Array.of(0x24, 0x68, 0xac)]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input.rgb", files.get("input.rgb")!);
            const argv = [...input, option, operand, "-depth", "8", "rgb:-"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdoutBytes" in result ? Buffer.from(result.stdoutBytes!).toString("hex") : stdout).toBe(expected);
        }
    });

    it.each([
        { operands: ["+blue-shift", "1", "xc:#2468ac"], error: "no images found for operation '+blue-shift'" },
        { operands: ["xc:red", "+delete", "+blue-shift", "1", "xc:#2468ac"], error: "no images found for operation '+blue-shift'" },
        { operands: ["xc:#2468ac", "+blue-shift"], error: "missing argument '+blue-shift'" },
    ])("preserves the destination on $error", async ({ operands, error }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out.rgb", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out.rgb", original);
        const argv = ["-depth", "8", ...operands, "rgb:out.rgb"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect("stderr" in result ? result.stderr : stderr).toContain(error);
        expect(mode === "sync" || mode === "buffered" ? files.get("out.rgb") : await fs.readFile("/out.rgb")).toEqual(original);
    });

    it("consumes the operand in mogrify before reading the input filename", async () => {
        const input = new TextEncoder().encode("P3\n1 1\n255\n36 104 172\n");
        const files = new Map([["input.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", input);
        const argv = ["mogrify", "+blue-shift", "abc", "-format", "rgb", "-depth", "8", "input.ppm"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "sync" || mode === "buffered" ? files.get("input.rgb")! : await fs.readFile("/input.rgb");
        expect(Buffer.from(output).toString("hex")).toBe("98a9ba");
    });
});
