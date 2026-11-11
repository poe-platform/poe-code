import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runIdentifyCli } from "./index.js";

it.each(["memory", "retained", "streamed"])("distinguishes RGBA histogram entries (%s)", async mode => {
    const pixels = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 128]);
    const bytes = await sharp(pixels, { raw: { width: 6, height: 1, channels: 4 } }).png().toBuffer();
    const filesystem = new MemoryFileSystem(), files = new Map([["rgba.png", bytes]]), chunks: Uint8Array[] = [];
    await filesystem.writeFile("/rgba.png", bytes);
    const input = mode === "memory" ? files : { filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(chunk: Uint8Array) { chunks.push(chunk.slice()); } } } : {}) };
    const result = await runConvertCli(["rgba.png", "-format", "%c", "histogram:info:-"], input);
    const expected = "             2: (255,0,0,255) #FF0000FF red\n"
        + "             1: (0,0,255,255) #0000FFFF blue\n"
        + "             1: (0,255,0,0) #00FF0000 srgba(0,255,0,0)\n"
        + "             1: (0,0,255,0) #0000FF00 srgba(0,0,255,0)\n"
        + "             1: (255,0,0,128) #FF000080 srgba(255,0,0,0.501961)\n";
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    if (mode === "streamed") expect(result.stdout).toBe("");
    const output = mode === "streamed" ? new TextDecoder().decode(Buffer.concat(chunks)) : result.stdout;
    expect(output.trimEnd().split("\n").sort()).toEqual(expected.trimEnd().split("\n").sort());
    expect(await runIdentifyCli(["-format", "%k", "rgba.png"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stdout: "5" });
    expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["rgba.png"]);
    expect([...files.keys()]).toEqual(["rgba.png"]);
});

// Native ImageMagick 7.1.2-35 Q16-HDRI uses a 14-character count field.
for (const mode of ["public", "buffered", "sync", "retained", "streamed"] as const) {
    it.each([1, 12, 105])(`aligns raw RGBA and RGB histogram counts (${mode}, %s pixels)`, async count => {
        for (const format of ["rgba", "rgb"]) {
            const pixel = format === "rgba" ? [128, 64, 32, 128] : [128, 64, 32];
            const bytes = Uint8Array.from(Array.from({ length: count }, () => pixel).flat());
            const files = new Map([["/in.bin", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.bin", bytes);
            let stdout = "", stderr = "";
            const sink = { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } };
            const args = ["-size", `${count}x1`, "-depth", "8", `${format}:/in.bin`, "-format", "%c", "histogram:info:"];
            const argumentValues = createCommandArguments(args);
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink,
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : {
                    filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: sink } : {})
                });
            const prefix = count === 1 ? "             1" : count === 12 ? "            12" : "           105";
            const color = format === "rgba" ? "(128,64,32,128) #80402080 srgba(128,64,32,0.501961)"
                : "(128,64,32) #804020 srgb(128,64,32)";
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(mode === "public" || mode === "streamed" ? stdout : "stdout" in result ? result.stdout : "")
                .toBe(`${prefix}: ${color}\n`);
        }
    });
}
