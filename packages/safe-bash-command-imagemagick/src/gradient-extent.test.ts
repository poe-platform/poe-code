import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 4x3 gray:- bytes in row order.
const diagonal = "003b76b127629dd84e89c4ff";
const vertical = "0000000080808080ffffffff";
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["-define", "gradient:extent=ellipse"], input: "gradient", expected: diagonal },
        { options: ["-define", "gradient:extent=minimum"], input: "gradient", expected: diagonal },
        { options: [], input: "gradient", expected: vertical },
        { options: ["-define", "gradient:vector=0,0 3,2"], input: "gradient", expected: diagonal },
        { options: ["-define", "gradient:extent=ellipse"], input: "radial-gradient", expected: "ffffffffff5555ffffffffff" },
        { options: ["-define", "gradient:extent=ellipse", "+define", "gradient:extent"], input: "gradient", expected: vertical },
        { options: ["-define", "gradient:extent=minimum", "-define", "gradient:direction=south"], input: "gradient", expected: vertical },
        { options: ["-define", "gradient:extent=ellipse", "-define", "gradient:angle=180"], input: "gradient", expected: vertical },
        { options: ["-define", "gradient:extent=ellipse", "-define", "gradient:vector=0,0 0,2"], input: "gradient", expected: vertical },
        // The presence of the extent artifact selects the default diagonal, regardless of value.
        ...["maximum", "diagonal", "circle", "ELLIPSE", "unknown", ""].map(extent => ({
            options: ["-define", `gradient:extent=${extent}`], input: "gradient", expected: diagonal
        }))
    ])(`${mode}: $options $input`, async ({ options, input, expected }) => {
        const argv = ["-size", "4x3", ...options, `${input}:black-white`, "-depth", "8", "gray:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let bytes: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString("hex")).toBe(expected);
    });
}
