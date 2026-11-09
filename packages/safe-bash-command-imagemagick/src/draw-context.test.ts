import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "filesystem", "command"]) {
    for (const draw of [
        "push graphic-context fill blue push graphic-context fill black point 0,0 pop graphic-context point 1,0 pop graphic-context point 2,0",
        "fill black point 0,0 fill blue point 1,0 fill red point 2,0",
        "pop graphic-context",
        "point 0,0 push graphic-context pop graphic-context pop graphic-context",
        "push unknown",
        "pop",
    ]) {
        it(`${mode}: draw context ${draw}`, async () => {
            const original = new TextEncoder().encode("keep");
            const files = new Map([["out.png", original]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out.png", original);
            const args = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", draw, "out.png"];
            const argumentValues = createCommandArguments(args);
            const context = {
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext;
            const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
            const output = mode === "map" ? files.get("out.png")! : await filesystem.readFile("/out.png");
            if (!draw.includes("point 2,0")) {
                expect(result.exitCode).not.toBe(0);
                expect(output).toEqual(original);
                return;
            }
            expect(result.exitCode).toBe(0);
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([7, 5]);
            expect([...image.data]).toEqual([
                0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255,
                ...Array.from({ length: 32 }, () => [255, 255, 255, 255]).flat(),
            ]);
        });
    }
}

it.each([
    {
        nested: "push graphic-context stroke blue stroke-width 3 push graphic-context stroke black stroke-width 1 line 1,1 5,1 pop graphic-context line 1,4 5,4 pop graphic-context line 1,7 5,7",
        flat: "stroke black stroke-width 1 line 1,1 5,1 stroke blue stroke-width 3 line 1,4 5,4 stroke red stroke-width 2 line 1,7 5,7",
    },
    {
        nested: "push graphic-context fill blue rectangle 0,0 2,2 pop graphic-context rectangle 4,0 6,2",
        flat: "rectangle 4,0 6,2 fill blue rectangle 0,0 2,2",
    },
    {
        nested: "push graphic-context fill blue point 0,0",
        flat: "fill blue point 0,0",
    },
])("restores drawing settings: $nested", async ({ nested, flat }) => {
    const files = new Map<string, Uint8Array>();
    expect((await runConvertCli(["-size", "1x1", "xc:green", "tile.png"], files)).exitCode).toBe(0);
    for (const [draw, output] of [[nested, "nested.png"], [flat, "flat.png"]]) {
        const result = await runConvertCli(["-size", "9x9", "xc:white", "-tile", "tile.png", "-stroke", "red", "-strokewidth", "2", "-draw", draw!, output!], files);
        expect(result.exitCode).toBe(0);
    }
    expect(decodeImage(files.get("nested.png")!).data).toEqual(decodeImage(files.get("flat.png")!).data);
});
