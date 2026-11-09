import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixture from "./grayscale-working-space-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: png:- -colorspace <space> -grayscale <method> PNG32:-.
// Decode the written PNG as RGBA8 so encoder colorspace handling is covered too.
const cases = [
    ...fixture.cases.map(({ space, method, gray }) => ({
        space, method, input: fixture.input,
        rgba: gray.flatMap((value, i) => [value, value, value, [128, 30, 0, 255, 80][i]!])
    })),
    ...fixture.original.cases.map(({ space, method, rgba }) => ({
        space, method, input: fixture.original.input, rgba: [...Buffer.from(rgba, "base64")]
    }))
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${execution}: computes $method from $space samples`, async ({ space, method, input: encoded, rgba }) => {
        const input = Buffer.from(encoded, "base64");
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-colorspace", space, "-grayscale", method, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "sync" ? runMagickCliSync(argv, files)
            : execution === "buffered" ? await runMagickCli(argv, files)
            : execution === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = execution === "command" || execution === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(rgba);
    });
}
