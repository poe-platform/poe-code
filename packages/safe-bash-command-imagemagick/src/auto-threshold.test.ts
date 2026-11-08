import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
    { values: [8,8,8,8,8,16,16,32,48,64,96,120,176,208,232,248], depth: 255, results: [[11, "37.6471%"], [10, "25.098%"], [5, "3.52941%"]] },
    { values: [32768,32768,32768,32768,32768,32896,32896,32896,33023,33023], depth: 65535, results: [[0, "0%"], [0, "0%"], [0, "0%"]] },
    { values: [0,0,0,0,0,32896,32896,32896,65535,65535], depth: 65535, results: [[5, "0%"], [10, "100%"], [5, "0.392157%"]] },
] as const;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const fixture of fixtures) {
        it.each(["OTSU", "Kapur", "Triangle"])(`computes %s for ${fixture.depth}-bit-range ${fixture.values[0]} via ${mode}`, async method => {
            const input = new TextEncoder().encode(`P2\n${fixture.values.length} 1\n${fixture.depth}\n${fixture.values.join(" ")}\n`);
            const files = new Map([["input.pgm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.pgm", input);
            const args = ["input.pgm", "-auto-threshold", method, "-write", "out.png", "-format", "%[auto-threshold:threshold]", "info:"];
            let stdout = "";
            if (mode === "command") {
                const argumentValues = createCommandArguments(args);
                const context = {
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
                } as unknown as CommandContext;
                expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode: 0 });
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0 });
                stdout = result.stdout;
            }
            const [black, threshold] = fixture.results[["OTSU", "Kapur", "Triangle"].indexOf(method)]!;
            expect(stdout.trim()).toBe(threshold);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data].filter((_, i) => i % 4 === 0)).toEqual(fixture.values.map((_, i) => i < black ? 0 : 255));
        });
    }
}

it("rejects unknown automatic threshold methods without replacing output", () => {
    const sentinel = new Uint8Array([1, 2, 3]);
    const files = new Map([["out.png", sentinel]]);
    expect(runConvertCliSync(["xc:red", "-auto-threshold", "unknown", "out.png"], files).exitCode).not.toBe(0);
    expect(files.get("out.png")).toBe(sentinel);
});
