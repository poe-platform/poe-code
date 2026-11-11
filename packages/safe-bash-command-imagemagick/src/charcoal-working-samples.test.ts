import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("13385d82a7ccf1163b", "hex")]);

// ImageMagick 7.1.2-35 Q16-HDRI, raw gray8 output from identical PPM bytes.
const cases = [
    { operations: [], gray: "c0258a" },
    { operations: ["-evaluate", "add", "100%"], gray: "c0258a" },
    { operations: ["-evaluate", "multiply", "10"], gray: "c0258a" },
    { operations: ["-alpha", "disassociate"], gray: "c0258a" },
    { operations: ["-evaluate", "add", "100%", "-clamp"], gray: "ffffff" },
    { operations: ["-evaluate", "multiply", "10", "-clamp"], gray: "c943c9" },
    { operations: ["-alpha", "disassociate", "-clamp"], gray: "ffffff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: charcoal preserves working samples after $operations`, async ({ operations, gray }) => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...operations, "-charcoal", "1x1", "-depth", "8", "gray:/out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(gray);
    });
}
