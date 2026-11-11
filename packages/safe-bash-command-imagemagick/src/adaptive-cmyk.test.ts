import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, using identical inline pixels and arguments.
const fixtures: { name: string; pixels?: string[]; before?: string[]; after?: string[]; depth?: string; coder?: string; control: string; sharpen: string; blur: string }[] = [
    { name: "neutral black ink", control: "000000af0000006f", sharpen: "000000be00000060", blur: "000000a10000007d" },
    { name: "default channels", before: ["-channel", "Default"], control: "000000af0000006f", sharpen: "000000be00000060", blur: "000000a10000007d" },
    { name: "reset channels", before: ["-channel", "C", "+channel"], control: "000000af0000006f", sharpen: "000000be00000060", blur: "000000a10000007d" },
    { name: "conversion back to RGB", after: ["-colorspace", "sRGB"], coder: "rgb", control: "505050909090", sharpen: "4141419f9f9f", blur: "5e5e5e828282" },
    { name: "selected black ink", before: ["-channel", "K"], control: "000000af0000006f", sharpen: "000000af0000006f", blur: "000000af0000006f" },
    { name: "unselected black ink", before: ["-channel", "C"], control: "000000af0000006f", sharpen: "000000af0000006f", blur: "000000af0000006f" },
    { name: "colored inks", pixels: ["xc:#406070", "xc:#809080"], control: "6d24008f1c001c6f", sharpen: "802d00961c001c6f", blur: "5c1d06881c001c6f" },
    { name: "independent alpha", pixels: ["xc:#50505080", "xc:#909090c0"], coder: "cmyka", control: "000000af800000006fc0", sharpen: "000000c87100000066cf", blur: "0000009c8e00000079b2" },
    { name: "16-bit ink", depth: "16", control: "000000000000afaf0000000000006f6f", sharpen: "000000000000be4f00000000000060cf", blur: "000000000000a1f50000000000007d29" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of ["control", "sharpen", "blur"] as const) {
    it.each(fixtures)(`${mode}: adaptive ${operation} handles $name`, async fixture => {
        const argv = [...(fixture.pixels ?? ["xc:#505050", "xc:#909090"]), "+append", "-colorspace", "CMYK", ...(fixture.before ?? []),
            ...(operation === "control" ? [] : [`-adaptive-${operation}`, "1x1"]), ...(fixture.after ?? []),
            "-depth", fixture.depth ?? "8", "-endian", "MSB", `${fixture.coder ?? "cmyk"}:-`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
        expect(hex).toBe(fixture[operation]);
    });
}
