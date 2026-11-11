import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operation: "-thumbnail", size: "1x1", property: undefined, expected: "https://imagemagick.org" },
        { operation: "-thumbnail", size: "1x1", property: "software", expected: "https://imagemagick.org" },
        { operation: "-thumbnail", size: "2x2", property: "Software", expected: "https://imagemagick.org" },
        { operation: "-thumbnail", size: "2x2", property: "sOfTwArE", expected: "https://imagemagick.org" },
        { operation: "-resize", size: "1x1", property: "software", expected: "original" },
        { operation: "-resize", size: "2x2", property: "Software", expected: "original" }
    ])(`${mode}: $operation sets Software correctly (size=$size, property=$property)`, async ({ operation, size, property, expected }) => {
        const args = ["-size", size, "xc:blue", ...(property ? ["-set", property, "original"] : []),
            operation, "1x1", "-format", "%[software]|%[Software]", "info:"];
        const filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } } });
            expect(result.exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stdout).toBe(`${expected}|${expected}`);
        expect(stderr).toBe("");
    });
}
