import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./grayscale-depth-fixtures.json" with { type: "json" };

// PNGs and decoded expectations from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    const cases = [
        ...fixtures.depths.flatMap(({ depth, input, cases }) => cases.map(({ args, rgba }) => ({
            name: `${depth}-bit ${args.join(" ")}`, inputs: { "in.png": input },
            argv: ["in.png", ...args, "PNG64:out.png"], rgba, depth: 16
        }))),
        ...fixtures.chains.map(({ args, rgba }) => ({
            name: args.join(" "), inputs: fixtures.inputs,
            argv: [...args, "PNG32:out.png"], rgba, depth: 8
        }))
    ];
    it.each(cases)(`${mode}: preserves native grayscale precision for $name`, async ({ inputs, argv, rgba, depth }) => {
        const files = new Map<string, Uint8Array>(Object.entries(inputs).map(([name, input]) => [name, Buffer.from(input, "base64")]));
        const fs = new MemoryFileSystem();
        for (const [name, input] of files) await fs.writeFile(`/${name}`, input);
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const image = decodeImage(output);
        expect(Array.from(depth === 16 ? image.data16 ?? [] : image.data)).toEqual(rgba);
    });
}
