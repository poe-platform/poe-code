import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"] as const) {
    it.each([
        { operands: ["a.ppm", "-bogus", "b.ppm"], stdout: "a.ppm:1x1;", stderr: "identify: unrecognized option '-bogus'\n" },
        { operands: ["-bogus", "a.ppm"], stdout: "", stderr: "identify: unrecognized option '-bogus'\n" },
        { operands: ["a.ppm", "+bogus", "b.ppm"], stdout: "a.ppm:1x1;", stderr: "identify: unrecognized option '+bogus'\n" },
        { operands: ["+bogus", "a.ppm"], stdout: "", stderr: "identify: unrecognized option '+bogus'\n" },
        { operands: ["a.ppm", "miss.ppm", "b.ppm"], stdout: "a.ppm:1x1;b.ppm:2x1;", stderr: "identify: unable to open image 'miss.ppm': No such file or directory\n" },
        { operands: ["a.ppm", "b.ppm"], stdout: "a.ppm:1x1;b.ppm:2x1;", stderr: "" },
        { operands: ["miss.ppm", "a.ppm", "-bogus", "b.ppm"], stdout: "a.ppm:1x1;", stderr: "identify: unable to open image 'miss.ppm': No such file or directory\nidentify: unrecognized option '-bogus'\n" }
    ])(`stops at unknown options and continues after missing inputs (${mode}, $operands)`, async ({ operands, stdout, stderr }) => {
        const files = new Map([
            ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
            ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
        ]);
        const args = ["-format", "%f:%wx%h;", ...operands];
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        let result;
        if (mode === "sync") result = runIdentifyCliSync(args, files);
        else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        else {
            const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
            const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
            let output = "", errors = "";
            const status = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } }
            });
            result = { ...status, stdout: output, stderr: errors };
        }
        expect(result).toEqual({ exitCode: stderr ? 1 : 0, stdout, stderr });
    });
}
