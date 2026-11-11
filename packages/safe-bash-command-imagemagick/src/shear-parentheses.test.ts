import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem", "command"])
for (const geometry of ["20x15", "(20x15)"])
it(`${mode}: uses both enclosed shear angles for ${geometry}`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["-size", "6x4", "xc:red", "-background", "black", "-shear", geometry,
        "-format", "%wx%h", "-write", "info:/dimensions.txt", "-depth", "8", "rgb:/out.rgb"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const dimensions = mode === "map" || mode === "sync" ? files.get("/dimensions.txt")! : await fs.readFile("/dimensions.txt");
    const raster = mode === "map" || mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(new TextDecoder().decode(dimensions)).toBe("7x5");
    // ImageMagick 7.1.2-35 Q16-HDRI, identical for bare and parenthesized geometry.
    expect(createHash("sha256").update(raster).digest("hex")).toBe("b0eecd5331370f6d5e0d796c8c2a8b0593bac4c6ec8333fa9ca848b4ba595d00");
});
