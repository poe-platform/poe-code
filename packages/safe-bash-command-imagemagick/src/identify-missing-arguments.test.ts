import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "identify", "magick"] as const) {
    it.each([
        ...["-format", "--format", "-define", "+define"].flatMap(option => [
            { args: ["-format", "%f:%wx%h;", "a.ppm", option], stdout: "a.ppm:1x1;", missing: option },
            { args: ["-format", "%f:%wx%h;", "a.ppm", "b.ppm", option], stdout: "a.ppm:1x1;b.ppm:2x1;", missing: option },
            { args: [option], stdout: "", missing: option },
            { args: ["a.ppm", option], stdout: "default", missing: option },
            { args: ["-format", "%f;", "absent.ppm", "a.ppm", option], stdout: "a.ppm;", missing: option }
        ]),
        { args: ["-format", "%f:%wx%h;", "a.ppm", "-format", "B%w;", "b.ppm"], stdout: "a.ppm:1x1;B2;", missing: "" },
        { args: ["-format", "%f:%wx%h;", "a.ppm", "-define", "example=yes", "b.ppm"], stdout: "a.ppm:1x1;b.ppm:2x1;", missing: "" },
        { args: ["-format", "%f;", "a.ppm", "-format", "", "b.ppm"], stdout: "a.ppm;", missing: "" }
    ])(`preserves identify output and reports missing arguments (${mode}): $args`, async ({ args, stdout: expected, missing }) => {
        const files = new Map([
            ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
            ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        let result;
        if (mode === "sync") result = runIdentifyCliSync(args, files);
        else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        else {
            const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
            const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
            let stdout = "", stderr = "";
            const status = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { ...status, stdout, stderr };
        }
        expect(result.exitCode).toBe(missing ? 1 : 0);
        if (expected === "default") {
            expect(result.stdout).toContain("a.ppm PPM 1x1 1x1+0+0 ");
            expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
        } else expect(result.stdout).toBe(expected);
        const diagnostics = result.stderr.trimEnd().split("\n").filter(Boolean);
        expect(diagnostics).toHaveLength(missing ? args.includes("absent.ppm") ? 2 : 1 : 0);
        if (missing) {
            expect(diagnostics.at(-1)).toContain("missing an argument");
            expect(diagnostics.at(-1)).toContain(`'${missing}'`);
        }
        if (args.includes("absent.ppm")) expect(diagnostics[0]).toContain("unable to open image 'absent.ppm'");
    });
}
