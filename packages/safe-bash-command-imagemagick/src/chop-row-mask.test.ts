import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI on macOS arm64, repeated 11 times per case.
const cases = [
    { name: "region", mask: ["-region", "1x1+1+0"], expected: "ff000080ff000080ff000080" },
    { name: "write mask", mask: ["-write-mask", "xc:white"], expected: "ff000080ff000080ff000080" },
    { name: "read mask", mask: ["-read-mask", "xc:white"], expected: "ff000080ff000080ff000080" },
    { name: "no mask", mask: [], expected: "ff000080ff000080ff000080" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: row chop with $name`, async ({ mask, expected }) => {
        const argv = ["-size", "3x2", "xc:#ff000080", ...mask, "-chop", "0x1+0+1",
            "+region", "+write-mask", "+read-mask", "-depth", "8", "-write", "rgba:/out",
            "-format", "%wx%h %g", "info:/geometry"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const retained = mode === "command" || mode === "retained";
        expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
        expect(new TextDecoder().decode(retained ? await fs.readFile("/geometry") : files.get("/geometry")!)).toBe("3x1 3x1+0+0");
    });
}
