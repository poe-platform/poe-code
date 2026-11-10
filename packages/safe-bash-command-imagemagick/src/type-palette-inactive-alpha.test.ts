import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex");

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs, including the opaque controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operations: ["-type", "Palette", "-alpha", "activate"], expected: input.toString("hex") },
        { operations: ["-type", "Palette", "-format", "%r|%[channels]|%k;"], expected: "PseudoClass sRGB |srgb  5.0|6;", info: true },
        { operations: ["-type", "Palette", "-cycle", "1"], expected: "603020ffa01010ff20a040ff2070b0ffd03090ff20a040ff603020ff1020c0ff" },
        { operations: ["-type", "Palette"], expected: "d03090ff2070b0ff603020ff20a040ff1020c0ff603020ffd03090ffa01010ff" },
        { operations: ["-alpha", "off", "-type", "Palette", "-cycle", "1"], expected: "603020ff1020c0ffa01010ff2070b0ffd03090ffa01010ff603020ff20a040ff" },
    ])(`${mode}: retains palette alpha after $operations`, async ({ operations, expected, info }) => {
        const files = new Map([["in.raw", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["-size", "4x2", "-depth", "8", "rgba:in.raw", ...operations, "-depth", "8", info ? "info:out" : "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(info ? "utf8" : "hex")).toBe(expected);
    });
}
