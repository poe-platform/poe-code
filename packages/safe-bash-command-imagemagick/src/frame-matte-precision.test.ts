import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: eight matte pixels surrounding one source pixel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { source: "#123456", matte: "#123456789abc", corner: "123456789abc", center: "121234345656" },
        { source: "#123456", matte: "gray(50%)", corner: "800080008000", center: "121234345656" },
        { source: "#123456", matte: "#123456789abc", corner: "123456789abc", center: "121234345656", raw: true },
        { source: "#123456", matte: "#123456", corner: "121234345656", center: "121234345656" },
        { source: "#abcd45670089", matte: "#123456789abc", corner: "123456789abc", center: "abcd45670089" },
        { source: "#123456", matte: "#123456789abc", corner: "123456789abc", center: "121234345656", option: true },
    ])(`${mode}: preserves every flat frame sample for $source and $matte (option=$option, raw=$raw)`, async ({ source, matte, corner, center, option, raw }) => {
        const fs = new MemoryFileSystem();
        const input = Uint8Array.of(0x12, 0x34, 0x56);
        const files = new Map([["/in.rgb", input]]);
        await fs.writeFile("/in.rgb", input);
        const args = [...(raw ? ["-size", "1x1", "-depth", "8", "rgb:/in.rgb"] : [`xc:${source}`]), ...(option ? ["-set", "option:mattecolor", matte] : ["-mattecolor", matte]),
            "-frame", "1x1", "-depth", "16", "-endian", "MSB", "rgb:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
        expect(bytes.toString("hex")).toBe(corner.repeat(4) + center + corner.repeat(4));
    });
}
