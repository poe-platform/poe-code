import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 output.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const fixture of [
    { name: "control", before: [], after: [], expected: "365b808e61868e6186837586b4a6457da2757b80918375868375866d5e8374998a7a9f917a9f916d5e836d5e83" },
    { name: "checkerboard", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], expected: "2d52777a9fc4587da2587da2bd9a3a365b8085aa8814395ef2173cf2173c6b9082d0f51aaed3f8aed3f8755378" },
    { name: "region", before: ["-region", "2x2+1+1"], after: ["+region"], expected: "0b30557a9fc4e90e33587da2c7ec11365b807a9f917a9f9183a8cdf2173c6186ab7a9f917a9f91aed3f81d4267" },
]) it(`Kuwahara ${fixture.name} mask (${mode})`, async () => {
    const files = new Map([
        ["/pic.ppm", Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => (11 + i * 37) % 256))])],
        ["/mask.pgm", Buffer.concat([Buffer.from("P5\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => i % 2 * 255))])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, data] of files) await fs.writeFile(path, data);
    const args = ["/pic.ppm", ...fixture.before, "-kuwahara", "1x1", ...fixture.after, "-depth", "8", "rgb:/out.rgb"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(Buffer.from(output).toString("hex")).toBe(fixture.expected);
});
