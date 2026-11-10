import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI counts a region as the frame's write-mask channel.
for (const mode of ["command", "buffered", "sync", "retained"])
it.each([
    { name: "active region", input: ["(", "-size", "2x3", "xc:#8040c080", "-region", "1x1+0+0", ")"], expected: "srgba 5.0;" },
    { name: "only the region-bearing frame", input: ["(", "-size", "2x3", "xc:#8040c080", "-region", "1x1+0+0", ")", "-size", "3x2", "xc:#30905040"], expected: "srgba 5.0;srgba 4.0;" },
    { name: "no mask", input: ["-size", "3x2", "xc:#30905040"], expected: "srgba 4.0;" },
    { name: "read mask", input: ["(", "-size", "2x3", "xc:#8040c080", "-read-mask", "/mask.pgm", ")"], expected: "srgba 5.0;" },
    { name: "write mask", input: ["-size", "2x3", "xc:#8040c080", "-write-mask", "/mask.pgm"], expected: "srgba 5.0;" },
    { name: "cleared region", input: ["-size", "2x3", "xc:#8040c080", "-region", "1x1+0+0", "+region"], expected: "srgba 4.0;" },
    { name: "region replacing a write mask", input: ["-size", "2x3", "xc:#8040c080", "-write-mask", "/mask.pgm", "-region", "1x1+0+0"], expected: "srgba 5.0;" },
    { name: "region and read mask", input: ["-size", "2x3", "xc:#8040c080", "-read-mask", "/mask.pgm", "-region", "1x1+0+0"], expected: "srgba 6.0;" }
])(`${mode}: formats channels with $name`, async ({ input, expected }) => {
    const files = new Map([
        ["/mask.pgm", new Uint8Array([...new TextEncoder().encode("P5\n2 3\n255\n"), 255, 0, 255, 0, 255, 0])],
        ["/out", new TextEncoder().encode("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = [...input, "-format", "%[channels];", "info:/out"];
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
    expect(new TextDecoder().decode(bytes)).toBe(expected);
});
