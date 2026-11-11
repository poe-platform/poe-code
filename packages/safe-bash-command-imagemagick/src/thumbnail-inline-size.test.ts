import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const ppm = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
// Native ImageMagick 7.1.2-35 writes zero for generated sources, replacing stale metadata.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { input: "xc:red", size: "0" },
        { input: "canvas:red", size: "0" },
        { input: "pattern:checkerboard", size: "0" },
        { input: "in.ppm", size: "17" },
    ])(`writes thumbnail source size for $input (${mode})`, async ({ input, size }) => {
        for (const metadata of [[], ["-set", "Thumb::Size", "99"]]) {
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", ppm);
            const files = new Map([["in.ppm", ppm]]);
            const args = ["-size", "8x6", input, ...metadata, "-thumbnail", "4x3", "-format", "%[Thumb::Size]", "info:"];
            let stdout = "", stderr = "", exitCode: number;
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
                exitCode = result.exitCode;
            } else {
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                ({ stdout, stderr, exitCode } = result);
            }
            expect({ stdout, stderr, exitCode }).toEqual({ stdout: size, stderr: "", exitCode: 0 });
        }
    });
}
