import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runIdentifyCli, runIdentifyCliSync, runMagickCliSync } from "./index.js";

const pgm = Buffer.from("50350a2366697273740a3120310a3235350a11", "hex");
const ppm = Buffer.from("50360a3120310a3235350aff0000", "hex");
const format = "%m:%[pixel:p{0,0}];";

// ImageMagick 7 keeps the first Netpbm coder name across the input sequence.
for (const [name, frames, pixels] of [
    ["PGM", [pgm, ppm], ["gray(17)", "srgb(255,0,0)"]],
    ["PPM", [ppm, pgm], ["srgb(255,0,0)", "gray(17)"]],
    ["PGM", [pgm], ["gray(17)"]],
    ["PPM", [ppm], ["srgb(255,0,0)"]]
] as const) {
    for (const selection of frames.length === 1 ? [""] : ["", "[0]", "[1]", "[1,0]"]) {
        it.each(["sync", "map", "retained", "command", "identify-sync", "identify-map", "identify-retained"] as const)(`reports ${name} for mixed frames ${selection} through %s`, async route => {
            const bytes = Buffer.concat(frames), files = new Map([["/in.pgm", bytes]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pgm", bytes);
            const input = `/in.pgm${selection}`;
            const args = [input, "-format", format, "info:"];
            let result;
            if (route === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                let stdout = "", stderr = "";
                const status = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
                result = { ...status, stdout, stderr };
            } else if (route.startsWith("identify-")) {
                const identifyArgs = ["-format", format, input];
                result = route === "identify-sync" ? runIdentifyCliSync(identifyArgs, files)
                    : await runIdentifyCli(identifyArgs, route === "identify-map" ? files : { filesystem, cwd: "/" });
            } else result = route === "sync" ? runMagickCliSync(args, files)
                : await runConvertCli(args, route === "map" ? files : { filesystem, cwd: "/" });
            const indices = selection === "[0]" ? [0] : selection === "[1]" ? [1] : selection === "[1,0]" ? [1, 0] : frames.map((_, index) => index);
            expect(result).toEqual({ exitCode: 0, stdout: indices.map(index => `${name}:${pixels[index]};`).join(""), stderr: "" });
        });
    }
}
