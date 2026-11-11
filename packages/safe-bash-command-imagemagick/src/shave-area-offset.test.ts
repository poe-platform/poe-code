import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI leaves scalar area geometry with offsets unchanged.
const pixels = Uint8Array.from({ length: 36 }, (_, index) => index * 7);
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), pixels]);

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const output of ["info", "rgb"] as const) {
        it.each([
            ["1@+1+1", false], ["1+1+1@", false], ["1@+0+0", false],
            ["1@-1-1", false], ["1@+1", false], ["1e+0@+1+1", false],
            ["1@", true], ["1x1+1+1", true], ["1x1@+1+1", true],
        ] as const)(`preserves scalar area offsets in shave %s (${mode}, ${output})`, async (geometry, cropped) => {
            const files = new Map([["/grid.ppm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/grid.ppm", input);
            const args = ["/grid.ppm", "-shave", geometry, "-depth", "8", "-format", "%wx%h", `${output}:/out`];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" || mode === "retained"
                ? await filesystem.readFile("/out") : files.get("/out")!;
            if (output === "info") expect(new TextDecoder().decode(bytes)).toBe(cropped ? "2x1" : "4x3");
            else expect(new Uint8Array(bytes)).toEqual(cropped ? pixels.slice(15, 21) : pixels);
        });
    }
}
