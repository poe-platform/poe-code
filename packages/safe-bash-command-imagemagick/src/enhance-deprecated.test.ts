import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: +enhance is deprecated; -enhance outputs 485c7a4b5f7d.
const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([70, 90, 120, 77, 97, 127])]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { option: "+enhance", grouped: false },
        { option: "+enhance", grouped: true },
        { option: "-enhance", grouped: false }
    ])(`${mode}: matches native $option status and output (grouped=$grouped)`, async ({ option, grouped }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map([["/in.ppm", input]]);
        await filesystem.writeFile("/in.ppm", input);
        const args = [...(grouped ? ["("] : []), "/in.ppm", option,
            ...(grouped ? [")"] : []), "-depth", "8", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        let exitCode: number;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        expect.soft(exitCode).toBe(option === "+enhance" ? 1 : 0);
        expect.soft(stderr).toBe(option === "+enhance"
            ? `magick: option deprecated, unable to execute '+enhance' at CLI arg ${grouped ? 3 : 2}\n` : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(option === "+enhance" ? "" : "485c7a4b5f7d");
    });
}
