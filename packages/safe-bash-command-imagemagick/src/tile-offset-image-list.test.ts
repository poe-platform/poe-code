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
    { offset: "+%[fx:n]+1", literal: "+2+1" },
    { offset: "+%[fx:u[1].w/3]+1", literal: "+2+1" },
    { offset: "+%[fx:t]+0", literal: "+0+0" },
    { offset: "+%[fx:n-2]+0", literal: "+0+0" },
    { offset: "+%[w]+1", literal: "+6+1" },
    { offset: "+%[option:offset]+1", literal: "+2+1" },
    { offset: "+%[fx:n]+1", literal: "+0+0", reset: true },
])(`${mode}: tile-offset expands $offset against the current image list (reset=$reset)`, async ({ offset, literal, reset }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = [
        "/in.ppm", "+clone", "-set", "option:offset", "2", "-tile-offset", offset,
        ...(reset ? ["+tile-offset"] : []), "-size", "5x4", "tile:/in.ppm", "-delete", "0,1",
        "-depth", "8", "rgb:/pixels",
    ];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
    const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
    const control = new Map([["/in.ppm", input]]);
    expect(runMagickCliSync([
        "/in.ppm", "+clone", "-tile-offset", literal, "-size", "5x4", "tile:/in.ppm", "-delete", "0,1",
        "-depth", "8", "rgb:/pixels",
    ], control).exitCode).toBe(0);
    expect(pixels).toHaveLength(60);
    expect(pixels).toEqual(control.get("/pixels"));
    if (literal === "+0+0") {
        expect(pixels).toEqual(Uint8Array.from(Array.from({ length: 4 }, (_, row) =>
            Array.from({ length: 15 }, (_, column) => row * 18 + column)).flat()));
    }
});

for (const offset of ["+%[fx:missing]+1", "%[option:bad]"])
it(`preserves the destination when tile-offset expansion is invalid: ${offset}`, async () => {
    const fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("keep");
    await fs.writeFile("/in.ppm", input);
    await fs.writeFile("/pixels", original);
    const args = ["/in.ppm", "+clone", "-set", "option:bad", "invalid", "-tile-offset", offset,
        "-size", "5x4", "tile:/in.ppm", "-delete", "0,1", "rgb:/pixels"];
    const result = await runMagickCli(args, { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toBe("");
    expect(await fs.readFile("/pixels")).toEqual(original);
});
