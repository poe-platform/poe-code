import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff804020c0ffee231337", "hex")]);

// ImageMagick 7.1.2-35 Q16-HDRI, positioned 3x2 PPM rotated 30 degrees to RGB8.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["integer", "f7f906f86149ce347fbd3a2dece30a56458678781f7959c58fca2fca089d163e"],
        ["background", "4c4bc5fbd1fcf8600d4e40ff01c4a2173f3b4c70fc61aa3442b3900630376da4"],
        ["average", "c477a0d848ce1f0cd84b417dd0d8f237ca6d6ffebd6c548e66cee51f99b7f9b9"],
        ["average4", "c477a0d848ce1f0cd84b417dd0d8f237ca6d6ffebd6c548e66cee51f99b7f9b9"],
        ["average9", "e2e880b87f4010d370cf8d0d41ee7a783377b9c279072509fe63f145a4ae3308"],
        ["average16", "abb27bdec659a29d3a8f67dce3ed57317563826700fa29a9f02f4f2b66e853a3"],
        ["bilinear", "53cf6d9aeb3cb221737f11e810367abfa081e43e5f1dc6d80f090b59b9f9307e"],
        ["nearest", "29a367c5b8ba6546f578c9b798783b6fb54205347565b64fd06c655a5d63c9f3"],
    ] as const)(`${mode}: matches native Point rotation with %s interpolation`, async (method, hash) => {
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-repage", "9x8+4+3", "-filter", "point", "-interpolate", method, "-rotate", "30", "-depth", "8", "rgb:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr,
        } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(5 * 6 * 3);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });

    it.each([
        ["#123456", [18, 52, 86, 255]],
        ["none", [0, 0, 0, 0]],
    ] as const)(`${mode}: uses %s for background interpolation`, async (color, pixel) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-filter", "point", "-interpolate", "background", "-background", color, "-rotate", "30", "-depth", "8", "rgba:/out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect([...output]).toEqual(Array.from({ length: 5 * 6 }, () => [...pixel]).flat());
    });

}


it.each([
    ["-filter", "point", "+interpolate", "-rotate", "30"],
    ["-rotate", "30"],
    ["-rotate", "90"],
    ["-swirl", "90"],
    ["-interpolative-resize", "5x4!"],
    ["-kuwahara", "1x1"],
])("preserves bilinear behavior for background interpolation in %j", (...operation) => {
    const files = new Map([["/in.ppm", input]]);
    for (const method of ["bilinear", "background"]) {
        const result = runConvertCliSync(["/in.ppm", "-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel", "-interpolate", method, ...operation, "-depth", "8", `rgba:/${method}`], files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    expect(files.get("/background")).toEqual(files.get("/bilinear"));
});

it("uses the background color for clut background interpolation", () => {
    const files = new Map([["/in.ppm", input]]);
    const result = runConvertCliSync(["/in.ppm", "-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel", "-interpolate", "background", "/in.ppm", "-clut", "-depth", "8", "rgba:/out"], files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    // Native ImageMagick 7.1.2-31 Q16-HDRI uses the default white background.
    expect(files.get("/out")).toEqual(new Uint8Array(3 * 2 * 4).fill(255));
});
