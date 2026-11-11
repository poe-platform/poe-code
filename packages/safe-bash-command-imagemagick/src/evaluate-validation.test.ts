import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Add", "bogus", undefined],
        ["Set", "0b0", undefined],
        ["Set", "0o0", undefined],
        ["Set", "0b100", undefined],
        ["Set", "0o100", undefined],
        ["Set", "+0b100", undefined],
        ["Set", "-0b100", undefined],
        ["Set", "+0o100", undefined],
        ["Set", "-0o100", undefined],
        ["Set", "0B100", undefined],
        ["Set", "0O100", undefined],
        ["Set", "0x20junk", undefined],

        ["Multiply", "2junk", undefined],
        ["Add", "", undefined],
        ["Add", "NaN", undefined],
        ["Multiply", "Infinity", undefined],
        ["Add", "50%junk", undefined],
        ["Divide", "2", [13, 50, 110, 255]],
        ["Divide", "+2e0", [13, 50, 110, 255]],
        ["Add", "-257", [24, 99, 219, 255]],
        ["Set", "50%", [128, 128, 128, 255]],
    ] as const)(`${mode}: validates evaluate %s %j before replacing output`, async (operator, operand, expected) => {
        const input = await sharp(Uint8Array.from([25, 100, 220]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const original = await sharp(Uint8Array.from([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.png", "-evaluate", operator, operand, "/out.png"];
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (expected) {
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(output).data]).toEqual(expected);
        } else {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument '-evaluate'");
            expect(stdout).toBe("");
            expect(output).toEqual(original);
        }
    });
}
