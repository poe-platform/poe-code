import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output, including decoded PNG32.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const append of ["+append", "-append"])
for (const format of ["rgba", "PNG32"])
it.each([
    { alpha: "Discrete", activate: false, channel: "", opaque: false, expected: "526a3688" },
    { alpha: "Discrete", activate: true, channel: "", opaque: false, expected: "526a3688" },
    { alpha: "Deactivate", activate: false, channel: "", opaque: false, expected: "526a36ff" },
    { alpha: "", activate: false, channel: "", opaque: false, expected: "526a3688" },
    { alpha: "Discrete", activate: false, channel: "RGB", opaque: false, expected: "526a36ff" },
    { alpha: "Discrete", activate: true, channel: "RGB", opaque: false, expected: "526a3680" },
    { alpha: "Discrete", activate: false, channel: "A", opaque: false, expected: "20408088" },
    { alpha: "Discrete", activate: false, channel: "", opaque: true, expected: "2a4c50ff" },
])(`${mode}: ${append} CLUT ${format} alpha=$alpha activate=$activate channel=$channel opaque=$opaque`, async ({ alpha, activate, channel, opaque, expected }) => {
    const argv = ["-respect-parentheses", "(", "xc:#20408080", ...(alpha ? ["-alpha", alpha] : []), ")",
        "(", opaque ? "xc:#103080" : "xc:#10308040", opaque ? "xc:#e0a020" : "xc:#e0a020d0", append, ")",
        ...(channel ? ["-channel", channel] : []), "-clut", ...(activate ? ["-alpha", "Activate"] : []),
        "-depth", "8", "-endian", "MSB", `${format}:${mode === "command" ? "-" : "/out"}`];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks)
        : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(format === "rgba" ? bytes : decodeImage(bytes).data).toString("hex")).toBe(expected);
});
