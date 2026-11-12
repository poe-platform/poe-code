import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves these distinct grays through normalization.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operations of [["-monochrome"], ["-type", "Bilevel"], []]) {
        it.each([
            { name: "16-bit colors", input: ["xc:#999999999999", "xc:#99b999b999b9", "+append"], raw: "99999999999999b999b999b9" },
            { name: "evaluated samples", input: ["-size", "1x1", "xc:#999999", "(", "+clone", "-evaluate", "add", "32", ")", "+append"], raw: "99999999999999b999b999b9" },
            { name: "adjacent 8-bit colors", input: ["xc:#999999", "xc:#9a9a9a", "+append"], raw: "9999999999999a9a9a9a9a9a" },
            { name: "dark 8-bit colors", input: ["xc:#303030", "xc:#404040", "+append"], raw: "303030303030404040404040" },
        ])(`${mode}: ${operations.join(" ") || "input control"} keeps $name distinct`, async ({ input, raw }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argv = [...input, ...operations, "-depth", operations.length ? "8" : "16", "-endian", "MSB", "rgb:/out"];
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
            expect(Buffer.from(output).toString("hex")).toBe(operations.length ? "000000ffffff" : raw);
        });
    }
}
