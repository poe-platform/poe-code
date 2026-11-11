import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Full RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-filter", "Mitchell"], geometry: "5x1!", expected: "00000000000e0000e300000e000000" },
        { options: ["-filter", "Gaussian"], geometry: "5x1!", expected: "00000000001b0000c900001b000000" },
        { options: ["-filter", "Lanczos", "-channel", "R"], geometry: "5x1!", expected: "0000000000ff000000000000000000" },
        { options: [], geometry: "5x1!", expected: "0000000000000000ff000000000000" },
        { options: ["-filter", "Mitchell", "+filter"], geometry: "5x1!", expected: "0000000000000000ff000000000000" },
        { options: ["-set", "option:filter", "Mitchell"], geometry: "5x1!", expected: "00000000000e0000e300000e000000" },
        { options: ["-filter", "Lanczos"], geometry: "7x1!", expected: "0000060000000000540000ff000054000000000006" },
        { options: ["-filter", "Lanczos", "-channel", "R"], geometry: "7x1!", expected: "0000000000000000ff000000000000000000000000" },
    ])(`matches native resize with $options at $geometry (${mode})`, async ({ options, geometry, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "5x1", "xc:black", "-fill", "blue", "-draw", "point 2,0", ...options,
            "-resize", geometry, "+channel", "+region", "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
