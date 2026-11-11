import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: -size 16x12 gradient:red-blue -sampling-factor 4:2:2 -quality 67.
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAsHCAkIBwsJCQkMCwsNEBoREA8PECAXGBMaJiIoKCYiJSQqMD0zKi05LiQlNUg1OT9BREVEKTNLUEpCTz1DREH/2wBDAQsMDBAOEB8RER9BLCUsQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUH/wAARCAAMABADASEAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAUG/8QAGRAAAQUAAAAAAAAAAAAAAAAAAAITFFFh/8QAFgEBAQEAAAAAAAAAAAAAAAAABwQG/8QAGREAAQUAAAAAAAAAAAAAAAAAAAMUFVFh/9oADAMBAAIRAxEAPwDHStErSiHw3UppKcVYcVYmNk6D1wpZ/9k=", "base64");

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const source of ["jpeg", "scoped", "unset"] as const) {
        it.each([
            { geometry: undefined, size: "16x12" },
            { geometry: "16x12", size: "16x12" },
            { geometry: "8x6", size: "8x6" },
            { geometry: "20x16", size: "20x16" },
            { geometry: "20x16+99+99", size: "20x16" },
        ])(`preserves ${source} quality through extent $geometry (${mode})`, async ({ geometry, size }) => {
            const files = new Map([["/input.jpg", jpeg]]), fs = new MemoryFileSystem();
            await fs.writeFile("/input.jpg", jpeg);
            const input = source === "jpeg" ? ["/input.jpg"] : ["-respect-parentheses", "(", "-size", "16x12",
                ...(source === "scoped" ? ["-quality", "67"] : []), "xc:red", ")"];
            const argv = [...input, ...(geometry ? ["-extent", geometry] : []), "-format", "%Q|%[quality]|%wx%h", "info:"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe(`${source === "unset" ? "92|0" : "67|67"}|${size}`);
        });
    }
}
