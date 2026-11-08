import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [["-flatten"], ["-layers", "flatten"]]) {
        it.each([undefined, 1, 2, 3, 4, 5, 6, 7, 8])(`${mode} ${operation.join(" ")} preserves input orientation %s without rotating pixels`, async orientation => {
            const pixels = Uint8Array.from([10, 50, 100, 150, 200, 245].flatMap(value => [value, value, value]));
            const source = sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } });
            const bytes = await (orientation === undefined ? source : source.withMetadata({ orientation })).jpeg({ quality: 100 }).toBuffer();
            const input = decodeImage(bytes);
            expect(input.orientation).toBe(orientation);
            if (mode === "command") {
                const native = spawnSync("magick", ["jpeg:-", "-background", "black", ...operation, "png:-"], { input: bytes });
                expect(native.status, native.stderr.toString()).toBe(0);
                expect(decodeImage(native.stdout)).toMatchObject({ width: 3, height: 2, data: input.data });
                expect(decodeImage(native.stdout).orientation).toBe(orientation);
            }
            const files = new Map([["in.jpg", bytes]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.jpg", bytes);
            const args = ["in.jpg", "-background", "black", ...operation, "out.png"];
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
                args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} } })
                : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual([3, 2]);
            expect(output.data).toEqual(input.data);
            expect(output.orientation).toBe(orientation);
        });
    }
}
