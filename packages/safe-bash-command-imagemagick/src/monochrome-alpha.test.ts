import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI makes monochrome pixels opaque.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "png"] as const) {
        it.each([
            { input: ["xc:#20408060"], operations: ["-monochrome"], hex: "000000ff" },
            { input: ["xc:#ff000040", "xc:#00ff0080", "+append"], operations: ["-monochrome"], hex: "000000ffffffffff" },
            { input: ["xc:#ff000040", "xc:#00ff0080", "+append"], operations: ["-type", "Bilevel"], hex: "000000ffffffffff" },
            { input: ["xc:#204080"], operations: ["-monochrome"], hex: "000000ff" },
        ])(`${mode}: ${format} opacity for $input $operations`, async ({ input, operations, hex }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argv = [...input, ...operations, "-depth", "8", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(format === "png" ? decodeImage(output).data : output).toString("hex")).toBe(hex);
        });
    }
}
