import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each(["xc:red", "in.ppm", "images/in.ppm"])(`reports native JSON source names (${mode}, %s)`, async source => {
        const ppm = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
        const fs = new MemoryFileSystem(), files = new Map([["in.ppm", ppm], ["images/in.ppm", ppm]]);
        await fs.writeFile("/in.ppm", ppm);
        await fs.mkdir("/images");
        await fs.writeFile("/images/in.ppm", ppm);
        const argv = [source, "json:-"];
        let result;
        if (mode === "public") {
            const argumentValues = createCommandArguments(argv);
            const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
            const execution = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { errors.push(bytes); } }
            });
            result = { exitCode: execution.exitCode, stdout: Buffer.concat(chunks).toString(), stderr: Buffer.concat(errors).toString() };
        } else {
            result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        }
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        // Parsed fields from native ImageMagick 7.1.2-35 Q16-HDRI.
        expect(JSON.parse(result.stdout)).toMatchObject([{ image: {
            name: source, baseName: source === "xc:red" ? "red" : "in.ppm",
            format: source === "xc:red" ? "XC" : "PPM",
            geometry: { width: source === "xc:red" ? 1 : 2, height: 1, x: 0, y: 0 }
        } }]);
    });
}
