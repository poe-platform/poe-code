import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n6 4\n255\n"),
    ...Array.from({ length: 72 }, (_, index) => index),
]);

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { geometry: "2x2!", widths: [2, 2] },
    { geometry: "%[fx:n]x2!", widths: [2, 2] },
    { geometry: "%[fx:u[1].w/3]x2!", widths: [2, 2] },
    { geometry: "%[fx:t+1]x2!", widths: [1, 2] },
    { geometry: "%[fx:u[0].w/3]x2!", widths: [2, 1] },
])(`${mode}: adaptive-resize evaluates $geometry against the current image list`, async ({ geometry, widths }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argumentValues = createCommandArguments([
        "/in.ppm", "+clone", "-adaptive-resize", geometry,
        "-depth", "8", "-write", "rgb:/pixels", "-format", "%wx%h|%g\n", "info:",
    ]);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
        : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stdout, stderr, ...result }).toMatchObject({
        exitCode: 0, stderr: "",
        stdout: widths.map(width => `${width}x2|${width}x2+0+0\n`).join(""),
    });
    const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
    const controls = widths.map(width => {
        const control = new Map([["/in.ppm", input]]);
        expect(runMagickCliSync([
            "/in.ppm", "-adaptive-resize", `${width}x2!`, "-depth", "8", "rgb:/pixels",
        ], control).exitCode).toBe(0);
        return control.get("/pixels")!;
    });
    expect(pixels).toEqual(Uint8Array.from(controls.flatMap(bytes => Array.from(bytes))));
});
