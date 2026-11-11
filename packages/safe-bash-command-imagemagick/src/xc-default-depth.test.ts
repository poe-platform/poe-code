import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI output, including explicit-depth controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { argv: ["xc:#123456", "ppm:out"], hex: "50360a3120310a36353533350a121234345656" },
        { argv: ["xc:red", "ppm:out"], hex: "50360a3120310a36353533350affff00000000" },
        { argv: ["xc:#123456", "-depth", "8", "ppm:out"], hex: "50360a3120310a3235350a123456" },
        { argv: ["xc:#123456", "-depth", "16", "ppm:out"], hex: "50360a3120310a36353533350a121234345656" },
        { argv: ["xc:#123456789abc", "ppm:out"], hex: "50360a3120310a36353533350a123456789abc" },
        { argv: ["in.ppm", "ppm:out"], hex: "50360a3120310a3235350a123456" },
        { argv: ["xc:red", "-format", "%z", "info:out"], hex: "3136" },
        { argv: ["xc:red", "-endian", "MSB", "rgba:out"], hex: "ffff00000000ffff" },
        { argv: ["xc:#123456789abc", "-endian", "MSB", "rgb:out"], hex: "123456789abc" },
        { argv: ["canvas:#123456789abc2345", "-endian", "MSB", "rgba:out"], hex: "123456789abc2345" },
        { argv: ["xc:#80402060", "-endian", "MSB", "gray:out"], hex: "4b98" },
        { argv: ["xc:red", "-depth", "8", "-endian", "MSB", "rgba:out"], hex: "ff0000ff" },
        { argv: ["xc:#123456789abc", "-depth", "16", "-endian", "MSB", "rgb:out"], hex: "123456789abc" },
        { argv: ["xc:red", "-depth", "8", "+depth", "-endian", "MSB", "rgba:out"], hex: "ffff00000000ffff" }
    ])(`${mode}: uses canvas depth for $argv`, async ({ argv, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        files.set("in.ppm", Buffer.from("50360a3120310a3235350a123456", "hex"));
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
