import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const compose of ["Copy", "Src", "Over"])
it.each([
    { depth: 8, coder: "cmyka", hex: "0080d31740" },
    { depth: 8, coder: "rgba", hex: "e8742840" },
    { depth: 16, coder: "cmyka", hex: "00008000d3dc17174040" },
    { depth: 16, coder: "rgba", hex: "e8e8747428284040" }
])(`${mode} CMYK ${compose} flatten preserves $depth-bit $coder channels`, async ({ depth, coder, hex }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["xc:#e8742840", "-colorspace", "CMYK", "-background", "none", "-compose", compose,
        "-flatten", "-depth", String(depth), "-endian", "MSB", `${coder}:/out`];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
