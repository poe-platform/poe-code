import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const option of ["-resize", "-scale", "-sample", "-thumbnail", "-adaptive-resize"]) {
        it.each(["bogus", "3xinvalid", "", "3/2", "2+1+2", "2+0", "2-1-2"])(`rejects ${option} %s without replacing output (${mode})`, async geometry => {
            const pixels = Uint8Array.from({ length: 96 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) + 1) * 10);
            const input = await sharp(pixels, { raw: { width: 6, height: 4, channels: 4 } }).png().toBuffer();
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const readOutput = async () => mode === "command" || mode === "retained"
                ? filesystem.readFile("/out.png") : files.get("/out.png");
            const run = async (value: string) => {
                const args = ["/in.png", option, value, "/out.png"];
                if (mode !== "command") return mode === "sync" ? runMagickCliSync(args, files)
                    : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                });
                return { ...result, stderr };
            };
            const fresh = await run(geometry);
            expect(fresh.exitCode).toBe(1);
            expect(fresh.stderr).toContain(`invalid argument for option '${option}'`);
            if (mode === "command" || mode === "retained") await expect(readOutput()).rejects.toThrow();
            else expect(await readOutput()).toBeUndefined();

            expect((await run("3x2")).exitCode).toBe(0);
            const original = decodeImage((await readOutput())!);
            expect([original.width, original.height]).toEqual([3, 2]);
            const existing = await run(geometry);
            expect(existing.exitCode).toBe(1);
            expect(existing.stderr).toContain(`invalid argument for option '${option}'`);
            const output = decodeImage((await readOutput())!);
            expect([output.width, output.height]).toEqual([3, 2]);
            expect(output.data).toEqual(original.data);
        });
    }
}
