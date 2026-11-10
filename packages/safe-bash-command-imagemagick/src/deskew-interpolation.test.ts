import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const cases = [
    ["nearest", "ebddf3ffebddf3ffebddf3ffebddf3ffebddf3ffebddf3ff"],
    ["average", "ebddf3ffebddf3ffebddf3ff818ca7ff818ca7ff818ca7ff"],
    ["spline", "ebddf3ffebddf3ffeaddf3ffc0bcd4ffb4b3cbffa7a9c2ff"],
    ["catrom", "ecddf3ffeddff5fff0e1f7ffe3d7edffd3cae1ffbfbbd3ff"],
    ["background", "ffffffffffffffffffffffffffffffffffffffffffffffff"],
    ["bilinear", "ebddf3ffebddf3ffebddf3ffddd2e9ffc9c3daffb5b4ccff"]
] as const;

// Native ImageMagick 7.1.2-35 Q16-HDRI, with Point filtering throughout.
for (const mode of ["public", "buffered", "retained", "sync"]) {
    it.each(cases)(`${mode}: deskew honors %s interpolation with Point filtering`, async (method, expected) => {
        const header = new TextEncoder().encode("P6\n32 12\n255\n");
        const input = new Uint8Array(header.length + 32 * 12 * 3);
        input.set(header);
        for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) {
            const stripe = x > 2 && x < 29 && Math.abs(y - 3 - Math.floor(x / 8)) <= 1;
            input.set(stripe ? [22, 58, 90] : [235, 221, 243], header.length + (y * 32 + x) * 3);
        }
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.ppm", "-filter", "point", "-interpolate", method, "-deskew", "40%", "+repage", "-crop", "3x2+12+4", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
