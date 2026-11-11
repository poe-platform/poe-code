import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 samples.
for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const)
it.each([
    { alpha: true, masked: true, threshold: "20%", expected: "070c52800a164f800f1d4b80142949801a3949801c524c800f0f4680161642801f243f8028343e80324a4780180d4780221644802d233f803c2f3d80" },
    { alpha: true, masked: true, threshold: "0", expected: "00006380030d5d80071c58800c2e5580134452801c5e518011074c8018164780212844802c3d4280395640801f013b80291037803521348044353180" },
    { alpha: true, masked: false, threshold: "20%", expected: "3732a5804852a28059619b806a759480748c928050b4948058399080694989807a6a828083827f807a9f988084349680954c9380a66b8c80b7778980" },
    { alpha: false, masked: true, threshold: "20%", expected: "342fa7ff3d4ba8ff4660a5ff4f80a3ff56aaa2ff54dfa1ff5b3393ff6e498eff817189ff919985ff9fca87ff8f2b91ffa84488ffc1677dffda8873ff" }
])(`${mode}: wavelet $threshold with external mask=$masked and translucent=$alpha`, async ({ alpha, masked, threshold, expected }) => {
    const input = Buffer.concat([
        Buffer.from("P6\n5 3\n255\n"),
        Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())
    ]);
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...(alpha ? ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"] : []),
        ...(masked ? ["-write-mask", "/in.ppm"] : []), "-wavelet-denoise", threshold, "+write-mask", "-depth", "8", "rgba:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
