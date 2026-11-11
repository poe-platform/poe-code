import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, using these exact P5 bytes.
const pgm = Buffer.from("50350a3120310a3235350a55", "hex");
const format = "%wx%h:%[pixel:p{0,0}];";
for (const route of ["sync", "map", "sdk", "identify", "magick"] as const) {
    it.each([
        { args: ["in.pgm"], stdout: "1x1:gray(85);" },
        { args: ["-ping", "multi.pgm", "+ping", "multi.pgm"], stdout: "1x1:gray(0);1x1:gray(0);1x1:gray(85);1x1:gray(85);" },
        { args: ["-ping", "multi.pgm[0,1]", "+ping", "multi.pgm[1]"], stdout: "1x1:gray(0);1x1:gray(0);1x1:gray(85);" },
        { args: ["-ping", "-format", "%[fx:mean+p{0,0}]|%[pixel:mean]|%[mean]|%[pixel:p{0,0}]", "in.pgm"], stdout: "0.333333|gray(0)|21845|gray(0)" },
        { args: ["+ping", "in.pgm"], stdout: "1x1:gray(85);" },
        { args: ["-ping", "in.pgm"], stdout: "1x1:gray(0);" },
        { args: ["-ping", "+ping", "in.pgm"], stdout: "1x1:gray(85);" },
        { args: ["+ping", "-ping", "in.pgm"], stdout: "1x1:gray(0);" },
        { args: ["--ping", "+ping", "in.pgm"], stdout: "1x1:gray(85);" },
        { args: ["-ping", "in.pgm", "+ping", "in.pgm"], stdout: "1x1:gray(0);1x1:gray(85);" },
        { args: ["+ping", "in.pgm", "-ping", "in.pgm"], stdout: "1x1:gray(85);1x1:gray(0);" },
        { args: ["-ping", "-verbose", "in.pgm"], stdout: "1x1:gray(85);" },
        { args: ["-verbose", "-ping", "in.pgm"], stdout: "1x1:gray(0);" },
        { args: ["-ping", "-format", "%[pixel:p{0,0}+0.5]", "in.pgm"], stdout: "gray(50%)" },
        { args: ["-ping", "-format", "%[fx:p{0,0}]|%[hex:p{0,0}]", "in.pgm"], stdout: "0|000000" }
    ])(`honors ping settings per input (${route}): $args`, async ({ args: operands, stdout: expected }) => {
        const args = ["-format", format, ...operands];
        const files = new Map([["in.pgm", pgm], ["multi.pgm", Buffer.concat([pgm, pgm])]]);
        let result;
        if (route === "sync") result = runIdentifyCliSync(args, files);
        else if (route === "map") result = await runIdentifyCli(args, files);
        else {
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            if (route === "sdk") result = await runIdentifyCli(args, { filesystem, cwd: "/" });
            else {
                const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
                const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
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
