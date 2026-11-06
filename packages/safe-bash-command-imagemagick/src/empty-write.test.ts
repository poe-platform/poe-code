import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "command"] as const)("rejects an empty write before later output (%s)", async mode => {
    for (const option of ["-write", "+write"]) for (const destination of ["mid.png", "r.png", "png:-", "null:", "mpr:empty"]) {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        for (const [name, pixel] of [["r.png", [255, 0, 0]], ["b.png", [0, 0, 255]]] as const) {
            const bytes = await sharp(new Uint8Array(pixel), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
            files.set(name, bytes);
            await fs.writeFile("/" + name, bytes);
        }
        const original = files.get("r.png")!;
        const args = ["r.png", "+delete", option, destination, "b.png", "-write", "later.png", "out.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("no images for write");
        const buffered = mode === "buffered" || mode === "sync";
        expect(buffered ? files.get("r.png") : await fs.readFile("/r.png")).toEqual(original);
        expect(buffered ? [...files.keys()].sort() : (await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["b.png", "r.png"]);
    }
});
