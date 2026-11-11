import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

const warningFormat = "A%[no-such-prop]B";
const dimensionsFormat = "%f:%wx%h;";

// Verified against ImageMagick 7.1.2-35: regard-warnings applies globally,
// and its + form does not cancel an earlier -regard-warnings.
for (const route of ["sync", "map", "sdk", "identify", "magick"] as const) {
    it.each([
        { args: ["-regard-warnings", "-format", warningFormat, "a.ppm"], exitCode: 1, stdout: "AB", warns: true },
        { args: ["+regard-warnings", "-format", dimensionsFormat, "a.ppm"], exitCode: 0, stdout: "a.ppm:1x1;", warns: false },
        { args: ["+regard-warnings", "-format", warningFormat, "a.ppm"], exitCode: 0, stdout: "AB", warns: true },
        { args: ["-format", warningFormat, "a.ppm"], exitCode: 0, stdout: "AB", warns: true },
        { args: ["-format", dimensionsFormat, "a.ppm", "b.ppm"], exitCode: 0, stdout: "a.ppm:1x1;b.ppm:2x1;", warns: false },
        { args: ["-regard-warnings", "-format", dimensionsFormat, "a.ppm", "b.ppm"], exitCode: 0, stdout: "a.ppm:1x1;b.ppm:2x1;", warns: false },
        { args: ["-regard-warnings", "+regard-warnings", "-format", warningFormat, "a.ppm"], exitCode: 1, stdout: "AB", warns: true },
        { args: ["-regard-warnings", "-format", warningFormat, "a.ppm", "-format", dimensionsFormat, "b.ppm"], exitCode: 1, stdout: "ABb.ppm:2x1;", warns: true },
        { args: ["-format", dimensionsFormat, "a.ppm", "-regard-warnings", "-format", warningFormat, "b.ppm"], exitCode: 1, stdout: "a.ppm:1x1;AB", warns: true },
        { args: ["-format", warningFormat, "a.ppm", "-regard-warnings", "-format", dimensionsFormat, "b.ppm"], exitCode: 1, stdout: "ABb.ppm:2x1;", warns: true }
    ])(`${route}: $args`, async ({ args, exitCode, stdout, warns }) => {
        const files = new Map([
            ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
            ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        let result;
        if (route === "identify" || route === "magick") {
            const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
            const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
            let output = "", errors = "";
            const status = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } } });
            result = { ...status, stdout: output, stderr: errors };
        } else result = route === "sync" ? runIdentifyCliSync(args, files)
            : await runIdentifyCli(args, route === "map" ? files : { filesystem, cwd: "/" });
        expect(result).toEqual({ exitCode, stdout, stderr: warns ? "magick: unknown image property '%[no-such-prop]'\n" : "" });
    });
}
