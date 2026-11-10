import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, immediately exporting the middle frame.
const cases = [
    { name: "first frame region", first: ["-region", "1x1+0+0"], second: [], hex: "213455eb993d" },
    { name: "first frame write mask", first: ["-write-mask", "mask.pgm"], second: [], hex: "0d1e4faf9179" },
    { name: "second frame region", first: [], second: ["-region", "1x1+0+0"], hex: "213455af9179" },
    { name: "second frame write mask", first: [], second: ["-write-mask", "mask.pgm"], hex: "213455af9179" },
    { name: "unmasked control", first: [], second: [], hex: "213455af9179" }
];

for (const mode of ["map", "sync", "filesystem", "command"])
it.each(cases)(`honors $name during morph blending (${mode})`, async ({ first, second, hex }) => {
    const files = new Map<string, Uint8Array>([
        ["a.ppm", Buffer.from("P3\n2 1\n255\n13 30 79 235 153 61\n")],
        ["b.ppm", Buffer.from("P3\n2 1\n255\n52 73 91 114 137 180\n")],
        ["mask.pgm", Buffer.from("P2\n2 1\n255\n255 0\n")],
        ["out", Buffer.from("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const argv = ["(", "a.ppm", ...first, ")", "(", "b.ppm", ...second, ")",
        "-morph", "1", "-delete", "0,2", "-endian", "MSB", "-depth", "8", "rgb:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    const bytes = mode === "command" || mode === "filesystem" ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
