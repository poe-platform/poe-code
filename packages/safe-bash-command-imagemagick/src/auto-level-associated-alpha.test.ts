import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output.
const cases = [
    { name: "associated alpha range", input: ["xc:#12345680"], operations: ["-alpha", "Associate", "-auto-level"], expected: "002549ff" },
    { name: "shared associated alpha range", input: ["xc:#12345680", "xc:#94ced340", "+append"], operations: ["-alpha", "Associate", "-auto-level"], expected: "002549ff3c5b5eff" },
    { name: "association alone", input: ["xc:#12345680"], operations: ["-alpha", "Associate"], expected: "091a2bff" },
    { name: "independent RGB ranges", input: ["xc:#12345680"], operations: ["-alpha", "Associate", "-channel", "RGB", "-auto-level", "+channel"], expected: "091a2bff" },
    { name: "alpha off", input: ["xc:#12345680"], operations: ["-alpha", "off", "-auto-level"], expected: "0080ffff" },
    { name: "active alpha range", input: ["xc:#12345680"], operations: ["-auto-level"], expected: "004f9eff" },
    { name: "off preserves already inactive associated alpha", input: ["xc:#12345680"], operations: ["-alpha", "Associate", "-alpha", "off", "-auto-level"], expected: "002549ff" },
    { name: "deactivation clears association", input: ["xc:#12345680"], operations: ["-alpha", "Associate", "-alpha", "Deactivate", "-auto-level"], expected: "0080ffff" },
    { name: "association without alpha", input: ["xc:#123456"], operations: ["-alpha", "Associate", "-auto-level"], expected: "0080ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "PNG32"] as const) {
        it.each(cases)(`${mode}, ${format}: auto-level uses $name`, async ({ input, operations, expected }) => {
            const argv = [...input, ...operations, "-depth", "8", `${format}:${mode === "command" ? "-" : "/out"}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv);
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(format === "rgba" ? bytes : decodeImage(bytes).data).toString("hex")).toBe(expected);
        });
    }
}
