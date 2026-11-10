import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs for palette channel extraction.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "palette red properties", palette: true, channel: "R", options: ["-format", "%r|%[channels]|"], output: "info:/out", expected: Buffer.from("DirectClass Gray |gray  1.0|") },
        { name: "direct red properties", palette: false, channel: "R", options: ["-format", "%r|%[channels]|"], output: "info:/out", expected: Buffer.from("DirectClass Gray |gray  1.0|") },
        { name: "palette red samples", palette: true, channel: "R", options: [], output: "gray:/out", expected: Buffer.from("2797", "hex") },
        { name: "palette alpha samples", palette: true, channel: "A", options: [], output: "gray:/out", expected: Buffer.from("af60", "hex") },
        { name: "palette red cycle", palette: true, channel: "R", options: ["-cycle", "1"], output: "gray:/out", expected: Buffer.from("9727", "hex") },
        { name: "palette alpha cycle", palette: true, channel: "A", options: ["-cycle", "1"], output: "gray:/out", expected: Buffer.from("60af", "hex") },
    ])(`${mode}: $name`, async ({ palette, channel, options, output, expected }) => {
        const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["xc:#274d93af", "xc:#97683560", "+append", ...(palette ? ["-type", "PaletteAlpha"] : []), "-channel", channel, "-separate", "+channel", ...options, "-depth", "8", output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect([...actual]).toEqual([...expected]);
    });
}
