import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["-gamma", "%[fx:w-1]", "2"],
        ["+gamma", "%[fx:1/(w-1)]", "0.5"],
        ["-gamma", "%[gain]", "2"],
        ["-gamma", "%[option:gain]", "2"],
    ])(`${mode}: resolves %s %s before applying gamma`, async (option, expression, literal) => {
        const data16 = Uint16Array.from([0, 16385, 65535].flatMap(r => [r, 24001, 40961, 32769]));
        const input = encodeImage({ width: 3, height: 1, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const outputs: Uint16Array[] = [];
        for (const value of [expression, literal]) {
            const files = new Map([["/in.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = ["/in.png", "-set", "gain", "2", "-set", "option:gain", "2", option, value, "PNG64:/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            outputs.push(decodeImage(output).data16!);
        }
        expect(outputs[0]).toEqual(outputs[1]);
        expect([...outputs[0]!.slice(4, 8)]).toEqual([32769, 39660, 51811, 46341]);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode}: evaluates gamma against each full image`, async () => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#404040", "-size", "600x2", "xc:#404040", "-gamma", "%[fx:w == 1 ? 1 : 2]", "+append", "PNG32:/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const decoded = decodeImage(output);
        expect([...decoded.data.slice(0, 4)]).toEqual([64, 64, 64, 255]);
        expect([...decoded.data.slice(4, 2404)]).toEqual(Array.from({ length: 600 }, () => [128, 128, 128, 255]).flat());
    });

    it(`${mode}: rejects invalid expanded gamma without replacing output`, async () => {
        const original = new TextEncoder().encode("keep");
        const files = new Map([["/out.png", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out.png", original);
        const args = ["-size", "1x1", "xc:red", "-set", "gain", "bogus", "-gamma", "%[gain]", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid gamma: bogus");
        expect(mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}
