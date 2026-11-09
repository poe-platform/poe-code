import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"] as const) {
    it.each([
        ["checkerboard", 30, 30],
        ["gray50", 32, 32],
        ["bricks", 16, 16]
    ] as const)(`uses natural dimensions for %s and honors explicit size (${mode})`, async (name, width, height) => {
        for (const explicitSize of [false, true]) {
            const seed = new TextEncoder().encode("keep");
            const files = new Map([["/out.png", seed]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out.png", seed);
            const argv = [...(explicitSize ? ["-size", "32x17"] : []), `pattern:${name}`, "/out.png"];
            if (mode === "command") {
                const args = createCommandArguments(argv);
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
                });
                expect(result.exitCode).toBe(0);
            } else {
                expect(await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" }))
                    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
            }
            const image = decodeImage(mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
            expect([image.width, image.height]).toEqual(explicitSize ? [32, 17] : [width, height]);
        }
    });
}
