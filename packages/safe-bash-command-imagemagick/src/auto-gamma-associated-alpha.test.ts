import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output.
const cases = [
    { name: "associated alpha", args: ["xc:#12345680", "-alpha", "Associate", "-auto-gamma"], expected: "3c5f76ff" },
    { name: "two associated pixels", args: ["xc:#12345680", "xc:#94ced340", "+append", "-alpha", "Associate", "-auto-gamma"], expected: "3c5f76ff6f8081ff" },
    { name: "association alone", args: ["xc:#12345680", "-alpha", "Associate"], expected: "091a2bff" },
    { name: "explicit RGB", args: ["xc:#12345680", "-alpha", "Associate", "-channel", "RGB", "-auto-gamma", "+channel"], expected: "808080ff" },
    { name: "alpha off", args: ["xc:#12345680", "-alpha", "off", "-auto-gamma"], expected: "50809fff" },
    { name: "active alpha", args: ["xc:#12345680", "-auto-gamma"], expected: "3d6c8daf" },
];

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "PNG32"] as const) {
        it.each(cases)(`${mode} ${format}: matches native auto-gamma with $name`, async ({ args, expected }) => {
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = [...args, "-depth", "8", `${format}:out`];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(format === "rgba" ? output : decodeImage(output).data).toString("hex")).toBe(expected);
        });
    }
}
