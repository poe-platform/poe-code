import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains both near-black colors after conversion.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const space of ["Lab", "XYZ", "Luv", "sRGB"]) {
        it.each(["count", "palette", "roundtrip"])(`preserves near-black ${space} colors (${mode}, %s)`, async operation => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const args = ["xc:#000100010001", "xc:#000200020002",
                ...(operation === "roundtrip" ? [] : ["xc:#000100010001"]), "+append", "-colorspace", space,
                ...(operation === "count" ? ["-format", "%k/%[colors]", "info:/out"]
                    : [...(operation === "palette" ? ["-unique-colors"] : []), "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"])];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString(operation === "count" ? "utf8" : "hex"))
                .toBe(operation === "count" ? "2/2" : "000100010001ffff000200020002ffff");
        });
    }
}
