import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Mean retains a zero-valued read mask.
const mask = Buffer.concat([Buffer.from("P5\n2 1\n255\n"), Buffer.from([0, 255])]);
const cases = [
    { name: "read mask on second input", masked: true, clear: false, expected: "0" },
    { name: "unmasked control", masked: false, clear: false, expected: "0.439216" },
    { name: "pixels after clearing mask", masked: true, clear: true, expected: "705068b7705068b7" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native sequence Mean: $name, ${mode}`, async ({ masked, clear, expected }) => {
        const files = new Map([["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = ["(", "-size", "2x1", "xc:#2060b080", ")", "(", "-size", "2x1", "xc:#c04020ed",
            ...(masked ? ["-read-mask", "mask.pgm"] : []), ")", "-evaluate-sequence", "Mean",
            ...(clear ? ["+read-mask", "-depth", "8", "rgba:out"] : ["-format", "%[fx:mean.r]", "info:out"])];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString(clear ? "hex" : "utf8")).toBe(expected);
    });
}
