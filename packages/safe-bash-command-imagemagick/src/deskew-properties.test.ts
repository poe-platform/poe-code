import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const fixtures = [
    { name: "full", file: "deskew-threshold.png", threshold: "40%", dimensions: [68, 39] },
    { name: "ragged", file: "deskew-properties-ragged.png", threshold: "0%", dimensions: [59, 34] },
].map(fixture => ({ ...fixture, input: readFileSync(new URL(`./fixtures/${fixture.file}`, import.meta.url)) }));

for (const mode of ["buffered", "retained", "sync", "mogrify", "command"] as const) {
    it.each(fixtures)(`expands deskew properties for $name (${mode})`, async ({ input, threshold, dimensions }) => {
        const reference = runConvertCliSync(["/in.png", "-deskew", threshold, "PNG32:-"], new Map([["/in.png", input]]));
        expect(reference.exitCode, reference.stderr).toBe(0);
        const expected = decodeImage(reference.stdoutBytes!);
        expect([expected.width, expected.height]).toEqual(dimensions);
        for (const value of ["%[fx:max(w-60,0)*10]%", "%[cut]", "%[option:cut]", "invalid"]) {
            const original = new TextEncoder().encode("preserve destination");
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const options = ["-set", "cut", value === "invalid" ? "invalid" : threshold, "-set", "option:cut", threshold,
                "-deskew", value === "invalid" ? "%[cut]" : value, "-set", "option:cut", "invalid"];
            const args = ["/in.png", ...options, "PNG32:/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "mogrify" ? await runMogrifyCli([...options, "/in.png"], files)
                : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png")
                : files.get(mode === "mogrify" ? "/in.png" : "/out.png")!;
            if (value === "invalid") {
                expect(result.exitCode).not.toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toContain("Invalid deskew threshold");
                expect(output).toEqual(mode === "mogrify" ? input : original);
            } else {
                expect(result.exitCode).toBe(0);
                const actual = decodeImage(output);
                expect([actual.width, actual.height]).toEqual(dimensions);
                expect(actual.data).toEqual(expected.data);
            }
        }
    });
}

it.each(["buffered", "retained", "sync"])("expands deskew against each current image (%s)", async mode => {
    const files = new Map(fixtures.map(({ name, input }) => [`/${name}.png`, input]));
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/full.png", "/ragged.png", "-deskew", "%[fx:max(w-60,0)*10]%", "/out-%d.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    for (const [index, fixture] of fixtures.entries()) {
        const path = `/out-${index}.png`;
        const actual = decodeImage(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!);
        const reference = runConvertCliSync([`/${fixture.name}.png`, "-deskew", fixture.threshold, "png:-"], files);
        expect(reference.exitCode, reference.stderr).toBe(0);
        expect([actual.width, actual.height]).toEqual(fixture.dimensions);
        expect(actual.data).toEqual(decodeImage(reference.stdoutBytes!).data);
    }
});
