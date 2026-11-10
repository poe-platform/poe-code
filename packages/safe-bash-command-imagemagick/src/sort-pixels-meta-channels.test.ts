import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
const cases = [
    { name: "channel 10", extra: [], operations: ["-sort-pixels"], channel: "10", expected: "162c210b" },
    { name: "channel 11", extra: ["gray:gray.gray"], operations: ["-sort-pixels"], channel: "11", expected: "162c210b" },
    { name: "unsorted extra channel", extra: [], operations: [], channel: "10", expected: "0b16212c" },
    { name: "sorted red control", extra: [], operations: ["-sort-pixels"], channel: "R", expected: "000c78dc" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { name, extra, operations, channel, expected } of cases) {
        it(`${mode}: sorts ${name} with the visible pixel`, async () => {
            const files = new Map([["gray.gray", Uint8Array.from([220, 0, 120, 12])],
                ["meta.gray", Uint8Array.from([11, 22, 33, 44])], ["out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
            const argv = ["-size", "4x1", "-depth", "8", "gray:gray.gray", "gray:gray.gray", "gray:gray.gray",
                "xc:white", ...extra, "gray:meta.gray", "-combine", ...operations,
                "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
