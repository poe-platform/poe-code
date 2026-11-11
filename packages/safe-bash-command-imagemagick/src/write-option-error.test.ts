import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "command"] as const)("preserves completed writes before an unknown option (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    files.set("r.png", await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer());
    await fs.writeFile("/r.png", files.get("r.png")!);
    const args = ["r.png", "-write", "one.png", "-negate", "-write", "two.png", "-invalid", "out.png"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(11);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unrecognized option '-invalid'");
    const buffered = mode === "buffered" || mode === "sync";
    expect(buffered ? [...files.keys()].sort() : (await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["one.png", "r.png", "two.png"]);
    for (const [path, pixels] of [["one.png", [255, 0, 0, 255]], ["two.png", [0, 255, 255, 255]]] as const) {
        const image = decodeImage(buffered ? files.get(path)! : await fs.readFile("/" + path));
        expect([image.width, image.height]).toEqual([1, 1]);
        expect([...image.data]).toEqual(pixels);
    }
});

for (const mode of ["buffered", "sync", "retained", "command"] as const)
for (const operator of ["-write", "+write"])
for (const depth of [false, true])
it.each([false, true])(`returns native missing-output syntax status (${mode}, ${operator}, depth=${depth}, existing=%s)`, async existing => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    if (existing) {
        files.set("saved.ppm", original);
        await fs.writeFile("/saved.ppm", original);
    }
    const args = ["xc:red", ...(depth ? ["-depth", "8"] : []), operator, "saved.ppm"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toEqual({ exitCode: 11, stdout: "", stderr: `magick: missing argument '${operator}' at CLI arg ${depth ? 4 : 2}\n` });
    if (mode === "buffered" || mode === "sync") expect([...files]).toEqual(existing ? [["saved.ppm", original]] : []);
    else {
        expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(existing ? ["saved.ppm"] : []);
        if (existing) expect(await fs.readFile("/saved.ppm")).toEqual(original);
    }
});

for (const mode of ["buffered", "sync", "retained", "command"] as const)
it.each(["-write", "+write"])(`accepts %s with a separate null output (${mode})`, async operator => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["xc:red", operator, "saved.ppm", "null:"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const image = decodeImage(mode === "buffered" || mode === "sync" ? files.get("saved.ppm")! : await fs.readFile("/saved.ppm"));
    expect([image.width, image.height]).toEqual([1, 1]);
    expect([...image.data]).toEqual([255, 0, 0, 255]);
});
