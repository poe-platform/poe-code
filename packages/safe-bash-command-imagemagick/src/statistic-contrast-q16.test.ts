import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const rgb = [3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240];
// Exact decoded RGBA16 from ImageMagick 7.1.2-35 Q16-HDRI.
const contrast = "edb6a2912569fffff924a2919999ffff76aca2917f5bffffe7b89101a7b9ffffcc5471028c63ffff";
const black = "000000000000ffff";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const depth of [8, 16])
it.each(["contrast", "constant", "identity"])(`${mode}: Q${depth} Contrast %s`, async control => {
    const input = Uint8Array.from([
        ...new TextEncoder().encode(`P6\n5 1\n${depth === 16 ? 65535 : 255}\n`),
        ...rgb.flatMap(value => depth === 16 ? [value, value] : [value]),
    ]);
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/in.ppm", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    await fs.writeFile("/out.png", keep);
    const argv = [
        ...(control === "identity" ? ["-set", "option:window", "3x1"] : []),
        control === "constant" ? "xc:#804020" : "/in.ppm",
        "-statistic", "Contrast", control === "identity" ? "1x1" : "3x1", "PNG64:/out.png",
    ];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    const decoded = decodeImage(output);
    expect([decoded.width, decoded.height]).toEqual([control === "constant" ? 1 : 5, 1]);
    expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join(""))
        .toBe(control === "contrast" ? contrast : black.repeat(control === "constant" ? 1 : 5));
});
