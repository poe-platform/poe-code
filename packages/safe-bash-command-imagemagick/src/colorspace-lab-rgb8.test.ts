import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI samples for RGB8 #9dc6ef.
for (const mode of ["sync", "command"] as const) {
    it.each([
        { options: ["-colorspace", "Lab", "-colorspace", "sRGB"], hex: "9da1c6c5efee" },
        { options: ["-colorspace", "Lab"], hex: "9da1c6c5efee" },
        { options: [], hex: "9d9dc6c6efef" },
    ])(`matches native RGB16 output after Lab conversion (${mode}, $options)`, async ({ options, hex }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n1 1\n255\n"), 157, 198, 239]);
        const args = ["/in.ppm", ...options, "-endian", "MSB", "-depth", "16", "rgb:/out"];
        const files = new Map([["/in.ppm", input]]);
        let output: Uint8Array, stderr = "";
        if (mode === "sync") {
            const result = runConvertCliSync(args, files);
            expect(result.exitCode).toBe(0);
            stderr = result.stderr;
            output = files.get("/out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
            output = await fs.readFile("/out");
        }
        expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
