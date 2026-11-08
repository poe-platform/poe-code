import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "command"] as const)("requires a separate final output after write (%s)", async mode => {
    for (const option of ["-write", "+write"]) for (const tail of [[], ["null:"], ["-negate", "out.png"]]) {
        const bytes = await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["r.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/r.png", bytes);
        const args = ["r.png", option, "mid.png", ...tail];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(tail.length ? 0 : 1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(tail.length ? "" : `magick: missing argument '${option}'\n`);
        const buffered = mode === "buffered" || mode === "sync";
        expect(buffered ? [...files.keys()].sort() : (await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(
            tail.length === 0 ? ["r.png"] : tail.length === 1 ? ["mid.png", "r.png"] : ["mid.png", "out.png", "r.png"]
        );
        if (tail.length) expect([...decodeImage(buffered ? files.get("mid.png")! : await fs.readFile("/mid.png")).data]).toEqual([255, 0, 0, 255]);
        if (tail.length === 2) expect([...decodeImage(buffered ? files.get("out.png")! : await fs.readFile("/out.png")).data]).toEqual([0, 255, 255, 255]);
        expect(buffered ? files.get("r.png") : await fs.readFile("/r.png")).toEqual(bytes);
    }
});
