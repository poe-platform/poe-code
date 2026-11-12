import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const coder of ["icon", "ICON", "IcOn", "ICO"])
for (const destination of ["-", "/sheet.ico"])
it(`${mode} writes ${coder}:${destination} as an ICO montage`, async () => {
    const args = ["-size", "16x16", "xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", `${coder}:${destination}`];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
            command: mode, args: mode === "magick" ? ["montage", ...args] : args,
            cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = destination === "-" ? Buffer.concat(chunks) : await fs.readFile(destination);
        if (destination !== "-") expect(chunks).toEqual([]);
    } else {
        const result = mode === "sync" ? runMontageCliSync(args, files)
            : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        output = destination === "-" ? result.stdoutBytes! : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
        if (destination !== "-") expect(result.stdout).toBe("");
    }
    const names = mode === "buffered" || mode === "sync" ? [...files.keys()]
        : (await fs.readdir("/")).map(entry => `/${entry.name}`);
    expect(names).toEqual(destination === "-" ? [] : [destination]);
    // Native ImageMagick emits one ICO directory entry containing the 32x16 sheet.
    expect(Array.from(output.slice(0, 8))).toEqual([0, 0, 1, 0, 1, 0, 32, 16]);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([32, 16]);
    for (const [x, rgba] of [[8, [255, 0, 0, 255]], [24, [0, 0, 255, 255]]] as const) {
        const offset = (8 * image.width + x) * 4;
        expect(Array.from(image.data.slice(offset, offset + 4))).toEqual(rgba);
    }
});
