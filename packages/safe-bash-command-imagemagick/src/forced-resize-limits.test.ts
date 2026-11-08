import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sample", "-resize", "-scale", "-thumbnail"]) {
        it.each([
            ["2x6!>", 2, 4],
            ["2x6!<", 6, 6],
            ["8x2!>", 6, 2],
            ["8x2!<", 8, 4],
            ["8x6!>", 6, 4],
            ["2x2!<", 6, 4],
        ] as const)(`${mode} ${option} limits each forced axis for %s`, async (geometry, width, height) => {
            const pixels = Uint8Array.from(Array.from({ length: 24 }, (_, i) => (i + 1) * 10).flatMap(value => [value, value, value]));
            const input = await sharp(pixels, { raw: { width: 6, height: 4, channels: 3 } }).png().toBuffer();
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const files = new Map([["/input.png", input]]);
            const args = ["/input.png", option, geometry, "/output.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            expect([output.width, output.height]).toEqual([width, height]);
            const expectedFiles = new Map([["/input.png", input]]);
            expect(runMagickCliSync(["/input.png", option, `${width}x${height}!`, "/expected.png"], expectedFiles).exitCode).toBe(0);
            expect(output.data).toEqual(decodeImage(expectedFiles.get("/expected.png")!).data);
            if (option === "-sample" && geometry === "2x6!>") {
                expect(Array.from(output.data.filter((_, i) => i % 4 === 0))).toEqual([20, 50, 80, 110, 140, 170, 200, 230]);
            }
        });
    }
}
