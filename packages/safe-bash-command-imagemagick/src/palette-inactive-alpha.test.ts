import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex");

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 output.
const reduced = "d03090ff2070b0ff5d2838ff20a040ff5d2838ff5d2838ffd03090ff5d2838ff";
const reducedAlpha = "d03090802070b0ff5d2838c020a040ff5d2838c05d2838c0d03090805d2838c0";
const cycled = "603020ffa01010ff20a040ff2070b0ffd03090ff20a040ff603020ff1020c0ff";
const cases = [
    ...["deactivate", "discrete"].flatMap(alpha => [
        { operations: ["-alpha", alpha, "-colors", "4"], expected: reduced },
        { operations: ["-alpha", alpha, "-colors", "4", "-alpha", "activate"], expected: reducedAlpha },
        { operations: ["-alpha", alpha, "-cycle", "1"], expected: cycled },
    ]),
    { operations: ["-alpha", "off", "-colors", "4"], expected: "d03090ff1848b8ff603020ff605828ff1848b8ff603020ffd03090ff603020ff" },
    { operations: ["-colors", "4"], expected: reducedAlpha },
    { operations: ["-alpha", "off", "-cycle", "1"], expected: "603020ff1020c0ffa01010ff2070b0ffd03090ffa01010ff603020ff20a040ff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: retains palette alpha for $operations`, async ({ operations, expected }) => {
        const files = new Map([["in.raw", input], ["out.raw", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["-size", "4x2", "-depth", "8", "rgba:in.raw", ...operations, "-depth", "8", "rgba:out.raw"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
