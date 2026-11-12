import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 5x3 gradient:#103050-#d0b090, depth-8 RGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { geometry: "^10x20", dimensions: "6x5", hash: "94d0ae35fbe7e094288a7611229064eb1f5ca1c836cde316bb27ca332ccbf7ec" },
    { geometry: "10x^20", dimensions: "6x5", hash: "94d0ae35fbe7e094288a7611229064eb1f5ca1c836cde316bb27ca332ccbf7ec" },
    { geometry: "10x20", dimensions: "6x5", hash: "94d0ae35fbe7e094288a7611229064eb1f5ca1c836cde316bb27ca332ccbf7ec" },
    { geometry: "0x20", dimensions: "5x5", hash: "8ea1dc85e1fbfd2266cc5b74248f787a76191ccdc6c50e0361c1026fefb2f762" },
    { geometry: "10x0", dimensions: "6x3", hash: "fe4133184a9e8b505beae7c81febbc6c2c2a201c50ffc40ed1372f00bc1b5287" },
])(`preserves shear angles with geometry modifiers (${mode}): $geometry`, async ({ geometry, dimensions, hash }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["-size", "5x3", "gradient:#103050-#d0b090", "-shear", geometry,
        "-format", "%wx%h", "-write", "info:/dimensions.txt", "-depth", "8", "rgb:/out.rgb"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const metadata = mode === "buffered" || mode === "sync" ? files.get("/dimensions.txt")! : await fs.readFile("/dimensions.txt");
    const raster = mode === "buffered" || mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect.soft(new TextDecoder().decode(metadata)).toBe(dimensions);
    expect(createHash("sha256").update(raster).digest("hex")).toBe(hash);
});
