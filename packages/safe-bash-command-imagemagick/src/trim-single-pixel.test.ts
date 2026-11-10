import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["PNG32", "info"] as const) {
        it.each([
            { size: "1x1", trim: true, pixel: [0x12, 0x34, 0x56, 255], geometry: "1x1 8x9+2+1", warning: false },
            { size: "1x1", trim: false, pixel: [0x12, 0x34, 0x56, 255], geometry: "1x1 8x9+2+1", warning: false },
            { size: "2x2", trim: true, pixel: [255, 255, 255, 0], geometry: "1x1 2x2-1-1", warning: true },
        ])(`${mode} ${format}: preserves native trim behavior for $size (trim=$trim)`, async test => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const argv = ["-size", test.size, "xc:#123456", "-repage", "8x9+2+1",
                ...(test.trim ? ["-trim"] : []), "-format", "%wx%h %g", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(test.geometry);
            else {
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([1, 1]);
                expect(decoded.data).toEqual(new Uint8Array(test.pixel));
            }
            if (test.warning) expect(stderr).toContain("geometry does not contain image");
            else expect(stderr).toBe("");
        });
    }
}
