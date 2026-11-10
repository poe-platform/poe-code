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

// Native ImageMagick 7.1.2-35 Q16-HDRI falls back to Otsu, ignoring option:method.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["invalid-method", "method", "26.6667%"],
        ["Undefined", "method", "26.6667%"],
        ["bad", "meth", "26.6667%"],
        ["Otsu", "method", "26.6667%"],
        ["Kapur", "method", "25.098%"],
    ] as const)(`${mode}: computes %s with option:%s set to Kapur`, async (method, option, threshold) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", original], ["/threshold", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = [
            "xc:#a1256650", "xc:#174476f0", "xc:#7bc8b012", "xc:#e5649633", "xc:#1243ac99", "+append",
            "-set", `option:${option}`, "Kapur", "-auto-threshold", method,
            "-colorspace", "sRGB", "-depth", "8", "-write", "rgba:/out",
            "-format", "%[auto-threshold:threshold]", "info:/threshold",
        ];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const property = mode === "command" || mode === "retained" ? await fs.readFile("/threshold") : files.get("/threshold")!;
        expect(new TextDecoder().decode(property)).toBe(threshold);
        if (method !== "Kapur") expect([...output]).toEqual([
            255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0,
        ]);
    });
}
