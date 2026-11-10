import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: regions and write masks replace the same restriction.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { selection: ["-region", "1x1+0+0", "-write-mask", "/mask.pgm"], hex: "0d1e4f1466c2" },
    { selection: ["-write-mask", "/mask.pgm", "-region", "1x1+0+0"], hex: "f2e1b0eb993d" },
    { selection: ["-write-mask", "/mask.pgm", "+region"], hex: "f2e1b01466c2" },
    { selection: ["-region", "1x1+0+0", "+write-mask"], hex: "f2e1b01466c2" },
    { selection: ["-write-mask", "/mask.pgm"], hex: "0d1e4f1466c2" },
    { selection: ["-region", "1x1+0+0"], hex: "f2e1b0eb993d" },
    { selection: ["-write-mask", "/mask.pgm", "+write-mask"], hex: "f2e1b01466c2" },
    { selection: ["-region", "1x1+0+0", "+region"], hex: "f2e1b01466c2" }
])(`${mode}: $selection`, async ({ selection, hex }) => {
    const files = new Map([
        ["/a.ppm", new TextEncoder().encode("P3\n2 1\n255\n13 30 79 235 153 61\n")],
        ["/mask.pgm", new TextEncoder().encode("P2\n2 1\n255\n255 0\n")],
        ["/out", new TextEncoder().encode("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/a.ppm", ...selection, "-negate", "-endian", "MSB", "-depth", "8", "rgb:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
