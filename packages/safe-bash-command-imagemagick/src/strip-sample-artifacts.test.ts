import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Status and complete RGB stdout from native ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "artifact before strip", options: ["-set", "artifact:sample:offset", "100", "-strip"] },
        { name: "artifact after strip", options: ["-strip", "-set", "artifact:sample:offset", "100"] },
        { name: "define before strip", options: ["-define", "sample:offset=100", "-strip"] },
        { name: "artifact without strip", options: ["-set", "artifact:sample:offset", "100"] },
        { name: "artifact overrides define after strip", options: ["-define", "sample:offset=0", "-set", "artifact:sample:offset", "100", "-strip"] },
    ])(`${mode} samples with $name`, async ({ options }) => {
        const args = ["xc:red", "xc:blue", "+append", "-set", "comment", "private comment", ...options, "-sample", "1x1!", "-depth", "8", "-write", "/output.png", "rgb:-"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe("0000ff");
        const png = mode === "command" || mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        const properties = decodeImage(png).properties;
        expect(properties?.comment).toBe(options.includes("-strip") ? undefined : "private comment");
        expect(properties?.["artifact:sample:offset"]).toBeUndefined();
    });
}
