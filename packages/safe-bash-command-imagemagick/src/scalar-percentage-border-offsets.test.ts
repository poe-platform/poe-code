import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "map", "retained", "sync"] as const) {
    it.each([
        ["1%+1+1", 3], ["1%+0+0", 3], ["2%+1+1", 3],
        ["200%+1+1", 3], ["1%+1", 3], ["1+1+1%", 3],
        ["1%", 0], ["1x1%+1+1", 0],
    ] as const)(`border %s matches native scalar percentage geometry (${mode})`, async (geometry, thickness) => {
        const pixels = Uint8Array.from({ length: 36 }, (_, i) => i * 7);
        const header = new TextEncoder().encode("P6\n4 3\n255\n");
        const input = new Uint8Array([...header, ...pixels]);
        const files = new Map([["/grid.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/grid.ppm", input);
        const argv = ["/grid.ppm", "-bordercolor", "black", "-border", geometry,
            "-format", "%wx%h", "-write", "info:/dimensions", "-depth", "8", "rgb:/output"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const width = 4 + thickness * 2, height = 3 + thickness * 2;
        const dimensions = mode === "map" || mode === "sync" ? files.get("/dimensions")! : await fs.readFile("/dimensions");
        expect(new TextDecoder().decode(dimensions)).toBe(`${width}x${height}`);
        const output = mode === "map" || mode === "sync" ? files.get("/output")! : await fs.readFile("/output");
        const expected = new Uint8Array(width * height * 3);
        for (let y = 0; y < 3; y++) {
            expected.set(pixels.subarray(y * 12, (y + 1) * 12), ((y + thickness) * width + thickness) * 3);
        }
        expect(output).toEqual(expected);
    });
}
