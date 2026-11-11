import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("P5\n3 2\n255\n\x01\x02\x03\x04\x05\x06");

// Path spelling verified against native ImageMagick.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        [".frame.pgm", "./.frame.pgm"],
        ["./plain.pgm", "././plain.pgm"],
        ["pgm:.frame.pgm", "./.frame.pgm"],
        ["plain.pgm", "./plain.pgm"],
        ["/plain.pgm", "file:///plain.pgm"]
    ])(`preserves native thumbnail URI spelling for %s (${mode})`, async (path, uri) => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/.frame.pgm", input);
        await filesystem.writeFile("/plain.pgm", input);
        const files = new Map([[".frame.pgm", input], ["plain.pgm", input], ["./plain.pgm", input], ["/plain.pgm", input]]);
        const args = [path!, "-thumbnail", "2x2", "-format", "%[Thumb::URI]", "info:"];
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
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(uri);
    });
}
