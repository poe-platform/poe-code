import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "public"] as const) {
    it.each([false, true])(`decodes bare histogram stdout as a MIFF plot (${mode}, palette=%s)`, async palette => {
        const input = Buffer.concat([Buffer.from("P6\n12 8\n255\n"), Buffer.from(Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256))]);
        const source = palette ? ["in.ppm", "+dither", "-colors", "5", "-unique-colors"] : ["-size", "2x1", "xc:red"];
        const outputs: Buffer[] = [];
        for (const destination of ["histogram:-", "histogram:ppm:-"]) {
            const filesystem = new MemoryFileSystem(), files = new Map([["in.ppm", input]]), chunks: Uint8Array[] = [];
            await filesystem.writeFile("/in.ppm", input);
            const args = [...source, destination];
            if (mode === "public") {
                const argumentValues = createCommandArguments(args);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
                outputs.push(Buffer.concat(chunks));
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                expect(result.stdoutBytes).toBeDefined();
                outputs.push(Buffer.from(result.stdoutBytes!));
            }
        }
        expect(await sharp(outputs[0]!).metadata()).toMatchObject({ format: "miff", width: 256, height: 200 });
        expect(await sharp(outputs[0]!).removeAlpha().raw().toBuffer()).toEqual(await sharp(outputs[1]!).removeAlpha().raw().toBuffer());
    });
}
