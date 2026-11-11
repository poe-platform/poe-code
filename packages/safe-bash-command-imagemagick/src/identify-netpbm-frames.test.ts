import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Native ImageMagick: adjacent P5 frames with different dimensions and comments.
const pgm = Buffer.from("50350a2366697273740a3120310a3235350a1150350a237365636f6e640a3220310a3235350a5566", "hex");
const format = "%wx%h:%c:%[pixel:p{0,0}];";

for (const route of ["sync", "map", "sdk", "identify", "magick", "info"] as const) {
    it.each([
        { input: "/in.pgm", options: [], expected: "1x1:first\n:gray(17);2x1:second\n:gray(85);" },
        { input: "/in.pgm", options: ["-ping"], expected: route === "info" ? "1x1:first\n:gray(17);2x1:second\n:gray(85);" : "1x1:first\n:gray(0);2x1:second\n:gray(0);" },
        { input: "/in.pgm[1]", options: [], expected: "2x1:second\n:gray(85);" },
        { input: "/in.pgm[0]", options: [], expected: "1x1:first\n:gray(17);" }
    ].filter(({ options }) => route !== "info" || options.length === 0))(`reads each Netpbm frame's metadata (${route}): $input $options`, async ({ input, options, expected, format: outputFormat = format }) => {
        const args = [...options, "-format", outputFormat, input];
        const files = new Map([["/in.pgm", pgm]]);
        let result;
        if (route === "sync") result = runIdentifyCliSync(args, files);
        else if (route === "map") result = await runIdentifyCli(args, files);
        else {
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pgm", pgm);
            if (route === "sdk") result = await runIdentifyCli(args, { filesystem, cwd: "/" });
            else {
                const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
                const argumentValues = createCommandArguments(route === "info" ? [...options, input, "-format", format, "info:"] : route === "magick" ? ["identify", ...args] : args);
                let stdout = "", stderr = "";
                const status = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
                result = { ...status, stdout, stderr };
            }
        }
        expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
