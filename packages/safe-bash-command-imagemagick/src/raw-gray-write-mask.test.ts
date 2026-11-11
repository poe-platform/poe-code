import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([25, 86, 147, 28, 89, 150])]);
const mask = ["(", "-size", "2x1", "xc:white", "-fill", "black", "-draw", "point 0,0", "-write", "mpr:mask", "+delete", ")", "/in.ppm", "-write-mask", "mpr:mask"];

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps the protected pixel's red sample.
for (const mode of ["command", "sync"] as const) {
    it.each([
        { name: "unrestricted", args: ["/in.ppm"], expected: "4d50" },
        { name: "region", args: ["/in.ppm", "-region", "1x1+0+0"], expected: "4d1c" },
        { name: "write mask", args: mask, expected: "4d1c" },
        { name: "cleared region", args: ["/in.ppm", "-region", "1x1+0+0", "+region"], expected: "4d50" },
        { name: "cleared write mask", args: [...mask, "+write-mask"], expected: "4d50" }
    ])(`exports raw gray with $name (${mode})`, async ({ args, expected }) => {
        const argv = [...args, "-depth", "8", "gray:-"];
        let exitCode: number, stderr = "";
        const stdout: Uint8Array[] = [];
        if (mode === "sync") {
            const result = runMagickCliSync(argv, new Map([["/in.ppm", input]]));
            ({ exitCode, stderr } = result);
            stdout.push(result.stdoutBytes!);
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const commandArgs = createCommandArguments(argv);
            ({ exitCode } = await createMagickCommand().execute({
                command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }));
        }
        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    });
}
