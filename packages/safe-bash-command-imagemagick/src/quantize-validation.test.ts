import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exit statuses and RGBA bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [inputs, options, space, expected] of [
        [["xc:red"], [], "bad", "KEEP"],
        [["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append"], ["+dither", "-colors", "2"], "bad", "KEEP"],
        [["xc:red"], [], "sRGB", "ff0000ff"],
        [["xc:red"], [], "Lab", "ff0000ff"],
        [["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append"], ["+dither", "-colors", "2"], "sRGB", "a85040ff706b3bff706b3bffa85040ffa85040ff"],
        [["xc:red"], [], "", "KEEP"],
        [["xc:red"], [], "sRgB", "ff0000ff"],
    ] as const) {
        it(`${mode}: validates -quantize ${JSON.stringify(space)} with ${options.join(" ") || "no reduction"}`, async () => {
            const sentinel = Buffer.from("KEEP");
            const files = new Map<string, Uint8Array>([["/out", sentinel]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", sentinel);
            const args = [...inputs, "-quantize", space, ...options, "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output)).toEqual(expected === "KEEP" ? sentinel : Buffer.from(expected, "hex"));
            expect(result.exitCode).toBe(expected === "KEEP" ? 1 : 0);
            expect("stderr" in result ? result.stderr : stderr).toEqual(expected === "KEEP"
                ? expect.stringContaining(`unrecognized colorspace '-quantize' '${space}'`) : "");
        });
    }
}
