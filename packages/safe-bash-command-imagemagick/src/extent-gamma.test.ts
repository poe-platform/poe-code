import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves source gamma when replacing the canvas.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { geometry: undefined, gamma: "0.8", expected: "0.8" },
        { geometry: "4x3", gamma: "0.8", expected: "0.8" },
        { geometry: "6x5", gamma: "0.8", expected: "0.8" },
        { geometry: "2x2", gamma: "0.8", expected: "0.8" },
        { geometry: "6x5+99+99", gamma: "0.8", expected: "0.8" },
        { geometry: "6x5", gamma: "0", expected: "0" },
        { geometry: "6x5", gamma: undefined, expected: "0.454545" },
    ])(`preserves gamma $gamma through extent $geometry (${mode})`, async ({ geometry, gamma, expected }) => {
        const seed = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", seed]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", seed);
        const argv = ["-size", "4x3", "xc:#4080c080", ...(gamma === undefined ? [] : ["-set", "gamma", gamma]),
            ...(geometry ? ["-extent", geometry] : []), "-format", "%[gamma]", "info:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
