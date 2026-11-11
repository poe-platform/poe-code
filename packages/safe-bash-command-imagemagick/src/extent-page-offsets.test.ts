import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2: scalar geometry and an omitted height
// with offsets inherit the virtual page height.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["2", "2x6", "2x6|5x18+1-3;", true],
        ["2@", "2x6", "2x6|5x18+1-3;", true],
        ["2", "2x2", "2x2|2x2+0+0;", false],
        ["+1+1", "8x6+1+1", "8x6|21x18+5-3;", true],
        ["2x+1+1", "2x6+1+1", "2x6|5x18+1-3;", true],
        ["+1+1", "3x2+1+1", "3x2|3x2+0+0;", false],
    ] as const)(`resolves extent %s against the page (${mode}, equivalent to %s)`, async (geometry, explicit, info, page) => {
        const execute = async (extent: string, output: string[]) => {
            const input = Uint8Array.from({ length: 18 }, (_, i) => i + 1);
            const files = new Map([["/in.rgb", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.rgb", input);
            const argv = ["-size", "3x2", "-depth", "8", "rgb:/in.rgb",
                ...(page ? ["-repage", "8x6+2-1"] : []), "-gravity", "Center", "-extent", extent, ...output];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            return output.at(-1) === "info:" ? ("stdout" in result ? result.stdout : stdout)
                : mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb");
        };
        expect(await execute(geometry, ["-format", "%wx%h|%g;", "info:"])).toBe(info);
        expect(await execute(explicit, ["-format", "%wx%h|%g;", "info:"])).toBe(info);
        expect(await execute(geometry, ["rgb:/out.rgb"])).toEqual(await execute(explicit, ["rgb:/out.rgb"]));
    });
}

it.each([
    ["2", true, "2x2|6x4+0+0", 4],
    ["2@", true, "2x2|6x4+0+0", 4],
    ["2x", true, "2x1|6x2+0+0", 2],
    ["2x2", true, "2x2|6x4+0+0", 4],
    ["2", false, "2x1|2x1+0+0", 2],
    ["2@", false, "2x1|2x1+0+0", 2],
] as const)("writes native scalar extent dimensions and pixels for %s (page: %s)", async (geometry, page, info, pixels) => {
    for (const output of [["-format", "%wx%h|%g", "info:"], ["-depth", "8", "rgb:-"]]) {
        const argumentValues = createCommandArguments(["xc:red", ...(page ? ["-repage", "3x2+0+0"] : []),
            "-background", "blue", "-extent", geometry, ...output]);
        const stdout: number[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        if (output.at(-1) === "info:") expect(new TextDecoder().decode(Uint8Array.from(stdout))).toBe(info);
        else expect(stdout).toEqual([255, 0, 0, ...Array.from({ length: pixels - 1 }, () => [0, 0, 255]).flat()]);
    }
});
