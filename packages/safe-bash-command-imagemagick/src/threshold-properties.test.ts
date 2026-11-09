import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["-threshold", "%[fx:w*8192]"],
        ["-threshold", "%[fx:QuantumRange/2]"],
        ["-set", "option:cut", "50%", "-threshold", "%[option:cut]"],
        ["-set", "option:cut", "50%", "-threshold", "%[cut]"],
        ["-set", "cut", "50%", "-threshold", "%[cut]"],
        ["-threshold", "32767.5"],
        ["-threshold", "50%"],
        ["-set", "option:cut", "bogus", "-threshold", "%[option:cut]"],
    ])(`${mode}: expands threshold arguments %j`, async (...options) => {
        const input = await sharp(Uint8Array.from([128, 128, 128, 128, 20, 70, 220, 40, 199, 48, 21, 230, 37, 37, 37, 96]), {
            raw: { width: 4, height: 1, channels: 4 }
        }).png().toBuffer();
        const original = new TextEncoder().encode("keep");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.png", ...options, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (options.includes("bogus")) {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument '-threshold'");
            expect(output).toEqual(original);
        } else {
            expect(result.exitCode).toBe(0);
            // Native ImageMagick 7.1.2-35 Q16-HDRI mask for these RGBA samples.
            expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe("ffffffff000000000000000000000000");
        }
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { input: ["-size", "600x2", "xc:#808080"], expression: "%[fx:w*64]", expected: Array<number>(1200).fill(0) },
        { input: ["-size", "1x1", "xc:#808080", "-size", "2x1", "xc:#808080"], expression: "%[fx:w*30000]", expected: [255, 0, 0] },
    ])(`${mode}: expands against each full image: $expression`, async ({ input, expression, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = [...input, "-threshold", expression, "+append", "PNG32:/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
