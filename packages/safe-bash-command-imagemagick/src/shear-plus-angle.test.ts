import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 5x3 gradient:#103050-#d0b090 -shear GEOMETRY.
const cases = [
    ...["20x+30", "20X+30", "(20x+30)", "20x +30", "20x+0", "20x+90", "20x"].map(geometry => ({
        geometry, dimensions: "6x4", hash: "3e4f7441902ea5d56b898f839df3c9817ead5739ab386ae08bed764171458c08"
    })),
    ...["20x30", "20,+30", "20/+30"].map(geometry => ({
        geometry, dimensions: "6x5", hash: "5a8bb07fa7b65f0686b170ceffdcc659e04e524f557013f8a83408c2208d49da"
    })),
    { geometry: "20x-30", dimensions: "6x7", hash: "1e546f0343b72665a6aeb5a5a7ac8d5878bbad9943de7a6d09701b0f955049e3" }
];

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
    it.each(cases)(`${mode}: matches native shear geometry $geometry`, async ({ geometry, dimensions, hash }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "5x3", "gradient:#103050-#d0b090", "-shear", geometry,
            "-format", "%wx%h", "-write", "info:/dimensions.txt", "-depth", "8", "rgb:/out.rgb"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const metadata = mode === "map" || mode === "sync" ? files.get("/dimensions.txt")! : await fs.readFile("/dimensions.txt");
        const raster = mode === "map" || mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
        expect.soft(new TextDecoder().decode(metadata)).toBe(dimensions);
        expect(createHash("sha256").update(raster).digest("hex")).toBe(hash);
    });
}
