import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGBA and computed opacity.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["rgba", "info"] as const) {
        it.each([
            { color: "#5080c080", alpha: ["-alpha", "off"], pixel: "d04020cc", opacity: "0.8" },
            { color: "#5080c0", alpha: ["-alpha", "off"], pixel: "d04020cc", opacity: "0.8" },
            { color: "#5080c080", alpha: [], pixel: "d0402066", opacity: "0.401569" },
            { color: "#5080c080", alpha: ["-alpha", "set"], pixel: "d0402066", opacity: "0.401569" },
            { color: "#50609080", alpha: ["-alpha", "deactivate"], pixel: "d0402066", opacity: "0.401569" },
            { color: "#50609080", alpha: ["-alpha", "associate"], pixel: "d0402066", opacity: "0.401569" },
            { color: "#50609080", alpha: ["-alpha", "disassociate"], pixel: "d0402066", opacity: "0.401569" },
            { color: "#50609080", alpha: ["-alpha", "opaque"], pixel: "d04020cc", opacity: "0.8" },
        ])(`renders native shadow alpha for $color $alpha (${mode}, ${format})`, async ({ color, alpha, pixel, opacity }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", files.get("/out")!);
            const argv = ["-size", "3x2", `xc:${color}`, ...alpha, "-background", "#d04020", "-shadow", "80x0+1+2", ...(format === "rgba" ? ["-depth", "8", "rgba:/out"] : ["-format", "%[fx:a]", "info:/out"])];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString(format === "rgba" ? "hex" : "utf8")).toBe(format === "rgba" ? pixel.repeat(6) : opacity);
        });
    }
}

// ImageMagick 7.1.2 native RGBA output, including the blurred edge pixels.
for (const output of ["out", "/out"])
for (const existing of [false, true])
it.each([
    { alpha: ["-alpha", "off"], sigma: 0, alphas: [204] },
    { alpha: ["-alpha", "opaque"], sigma: 0, alphas: [204] },
    { alpha: [], sigma: 0, alphas: [102] },
    { alpha: ["-alpha", "off"], sigma: 1, alphas: [1, 3, 5, 3, 1, 3, 12, 19, 12, 3, 5, 19, 30, 19, 5, 3, 12, 19, 12, 3, 1, 3, 5, 3, 1] },
])(`exports native shadow bytes to ${output}, existing=${existing}: $alpha sigma=$sigma`, async ({ alpha, sigma, alphas }) => {
    const fs = new MemoryFileSystem();
    if (existing) await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const argumentValues = createCommandArguments(["xc:#50609080", ...alpha, "-background", "#d04020", "-shadow", `80x${sigma}+0+0`, "-depth", "8", `rgba:${output}`]);
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    expect([...await fs.readFile("/out")]).toEqual(alphas.flatMap(alpha => [208, 64, 32, alpha]));
});
