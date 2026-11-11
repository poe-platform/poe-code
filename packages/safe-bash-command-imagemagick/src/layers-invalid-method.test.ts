import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(["not-a-method", "deconstruct", "mosaic", "merge"])(`handles -layers %s (${mode})`, async method => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...Array.from({ length: 18 }, (_, i) => (i + 1) * 10)]);
        const files = new Map([["in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["in.ppm", "-layers", method, "-format", "%wx%h", "info:"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        const valid = method === "mosaic" || method === "merge";
        expect(result).toMatchObject({
            exitCode: valid ? 0 : 1,
            stdout: valid ? "3x2" : "",
            stderr: valid ? "" : `magick: UnrecognizedLayerMethod '-layers' '${method}'\n`
        });
    });
}
