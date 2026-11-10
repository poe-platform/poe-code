import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references for the 3x3 pixel-art reproduction.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const [method, hash] of [
        ["eagle3x", "75a165a14e258ecb99ce73fa065191606b7e5d7cff9ce9a601df1e1994c1fd21"],
        ["scale3x", "4cf18e7d0c46c169e7076e2a60e8b96b8091cf129ac107c3476dd6185a7ce9f9"]
    ]) {
        it.each(["info", "rgb"])(`${mode}: ${method} matches native %s output`, async format => {
            const colors = [[239, 64, 32], [34, 102, 238], [23, 223, 144]];
            const input = new Uint8Array([...new TextEncoder().encode("P6\n3 3\n255\n"), ...[0, 1, 1, 0, 0, 1, 2, 0, 0].flatMap(index => colors[index]!)]);
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["im.ppm", input], ["out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/im.ppm", input);
            await filesystem.writeFile("/out", original);
            const args = ["im.ppm", "-define", `magnify:method=${method}`, "-magnify", ...(format === "info" ? ["-format", "%wx%h"] : ["-depth", "8"]), `${format}:out`];
            let stdout = "", stderr = "";
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stdout).toBe("");
            expect(result.stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await filesystem.readFile("/out");
            if (format === "info") expect(new TextDecoder().decode(output)).toBe("9x9");
            else {
                expect(output).toHaveLength(243);
                expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
            }
        });
    }
}
