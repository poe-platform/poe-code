import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: RGB565 is read-only and falls back to PGM.
const input = Buffer.from("50360a3420320a3235350aff000000ff000000ffffffff000000ff8000fe0180804080", "hex");
for (const mode of ["command", "sync"] as const) {
    for (const write of [false, true]) {
        it(`${mode}: preserves RGB565 warning, status, literal destination and P5 bytes (${write ? "-write" : "output"})`, async () => {
            const args = ["in.ppm", "-depth", "8", ...(write ? ["-write", "rgb565:-", "null:"] : ["rgb565:-"])];
            const files = new Map<string, Uint8Array>([["in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) expect(result.stdoutBytes.length).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toContain("no encode delegate for this image format `RGB565'");
            expect(Buffer.from(mode === "sync" ? files.get("rgb565:-")! : await fs.readFile("/rgb565:-")).toString("hex"))
                .toBe("50350a3420320a3235350a36b612ff00924052");
        });
    }
    it(`${mode}: keeps RGB stdout output working`, async () => {
        const args = ["in.ppm", "-depth", "8", "rgb:-"];
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout)
            .toBe("ff000000ff000000ffffffff000000ff8000fe0180804080");
        expect(mode === "sync" ? [...files.keys()] : (await fs.readdir("/")).map(entry => entry.name)).toEqual(["in.ppm"]);
    });
}
