import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./evaluate-sequence-noise-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1, decoded RGBA8.
for (const scenario of fixtures)
for (const mode of ["map", "sync", "retained", "command"] as const) {
    it.each(scenario.cases)(`${mode} ${scenario.name}: sequence $operation seed=$seed channel=$channel frames=$count`, async fixture => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const paths = scenario.inputs.slice(0, fixture.count).map((_, index) => `/in${index}.png`);
        for (const [index, path] of paths.entries()) {
            const bytes = Buffer.from(scenario.inputs[index]!, "hex");
            files.set(path, bytes);
            await fs.writeFile(path, bytes);
        }
        const argv = ["-seed", String(fixture.seed), ...paths, ...(fixture.channel ? ["-channel", fixture.channel] : []), "-evaluate-sequence", fixture.operation, scenario.depth === 16 ? "PNG64:/out.png" : "PNG32:/out.png"];
        for (let repeat = 0; repeat < 2; repeat++) {
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            const image = decodeImage(output);
            expect([...(scenario.depth === 16 ? image.data16! : image.data)]).toEqual(fixture.expected);
        }
    });
}
