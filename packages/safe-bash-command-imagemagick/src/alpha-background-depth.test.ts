import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function convert(argv: string[], input?: Uint8Array) {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        if (input) {
            files.set("in.pam", input);
            await fs.writeFile("/in.pam", input);
        }
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0, ...(mode === "command" ? {} : { stderr: "" }) });
        expect(stderr).toBe("");
        return Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!).toString("hex");
    }

    // Native ImageMagick 7.1.2-35 Q16-HDRI samples, including no-op and zero-alpha controls.
    it.each([
        ["0000ffff00000001", false, "0000ffff00000001"],
        ["0000ffff00000001", true, "0000ffff00000001"],
        ["0000ffff00000002", true, "0000ffff00000002"],
        ["123456789abc8000", true, "123456789abc8000"],
        ["123456789abcffff", true, "123456789abcffff"],
        ["0000ffff00000000", true, "ffffffffffff0000"],
    ] as const)(`${mode}: alpha background retains %s (apply=%s)`, async (pixel, apply, expected) => {
        expect(await convert([`xc:#${pixel}`, "-background", "white", ...(apply ? ["-alpha", "background"] : []),
            "-depth", "16", "-endian", "MSB", "rgba:out"])).toBe(expected);
    });

    it.each([false, true])(`${mode}: alpha background preserves five PAM palette entries (evaluate=%s)`, async evaluate => {
        const pixels = "0000ffff000000000000ffff000000010000ffff00000002123456789abc8000123456789abcffff";
        const input = Buffer.concat([Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from(pixels, "hex")]);
        const output = await convert(["in.pam", ...(evaluate ? ["-channel", "RGBA", "-evaluate", "Add", "0", "+channel"] : []),
            "-background", "white", "-alpha", "background", "-unique-colors", "-depth", "16", "-endian", "MSB", "rgba:out"], input);
        const samples = Array.from({ length: output.length / 16 }, (_, index) => output.slice(index * 16, (index + 1) * 16));
        expect(samples.sort()).toEqual(["ffffffffffff0000", "0000ffff00000001", "0000ffff00000002", "123456789abc8000", "123456789abcffff"].sort());
    });
}
