import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete output bytes from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { name: "Over RGBA16", args: ["xc:#2698ba90", "xc:#be6a3080", "-compose", "Over", "-composite", "-depth", "16", "-endian", "MSB", "rgba:-"], hex: "87f27aff61f0c87f" },
    { name: "SrcOver RGBA16", args: ["xc:#2698ba90", "xc:#be6a3080", "-compose", "SrcOver", "-composite", "-depth", "16", "-endian", "MSB", "rgba:-"], hex: "87f27aff61f0c87f" },
    { name: "Over RGBA8", args: ["xc:#2698ba90", "xc:#be6a3080", "-compose", "Over", "-composite", "-depth", "8", "rgba:-"], hex: "877b62c8" },
    { name: "SrcOver RGBA8", args: ["xc:#2698ba90", "xc:#be6a3080", "-compose", "SrcOver", "-composite", "-depth", "8", "rgba:-"], hex: "877b62c8" },
    { name: "Over border RGBA16", args: ["xc:#be6a3080", "-bordercolor", "#2698ba90", "-compose", "Over", "-border", "1x0", "-depth", "16", "-endian", "MSB", "rgba:-"], hex: "26269898baba909087f27aff61f0c87f26269898baba9090" },
    { name: "SrcOver border RGBA8", args: ["xc:#be6a3080", "-bordercolor", "#2698ba90", "-compose", "SrcOver", "-border", "1x0", "-depth", "8", "rgba:-"], hex: "2698ba90877b62c82698ba90" },
    { name: "DstOver RGBA16 control", args: ["xc:#2698ba90", "xc:#be6a3080", "-compose", "DstOver", "-composite", "-depth", "16", "-endian", "MSB", "rgba:-"], hex: "50b88bb69414c87f" },
    { name: "Over 16-bit source control", args: ["xc:#2698ba90", "xc:#beef6a42302180ba", "-compose", "Over", "-composite", "-depth", "16", "-endian", "MSB", "rgba:-"], hex: "88327adc61c9c899" },
];

for (const route of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${route}: $name matches native blending`, async ({ args, hex }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(args), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = route === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : route === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = route === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
