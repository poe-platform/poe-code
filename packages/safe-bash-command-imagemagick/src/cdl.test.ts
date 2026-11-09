import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const source = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTM6MjE6NDArMDA6MDAiMC6kAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDEzOjIxOjQwKzAwOjAwU22WGAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxMzoyMTo0MCswMDowMAR4t8cAAAAVSURBVAjXYxDUiAqoWLDPSO7OpRQAG4cFHJ1mLYwAAAAASUVORK5CYII="), character => character.charCodeAt(0));
const desaturate = '<ColorCorrectionCollection><ColorCorrection id="grade"><SOPNode><Slope>1 1 1</Slope><Offset>0 0 0</Offset><Power>1 1 1</Power></SOPNode><SatNode><Saturation>0</Saturation></SatNode></ColorCorrection></ColorCorrectionCollection>';

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { name: "desaturation", xml: desaturate, expected: [39, 39, 39, 255, 114, 114, 114, 255, 78, 78, 78, 255, 204, 204, 204, 255] },
        { name: "identity", xml: '<ColorCorrectionCollection><ColorCorrection><SATNode><Saturation>1</Saturation></SATNode></ColorCorrection></ColorCorrectionCollection>', expected: [17, 40, 90, 255, 80, 120, 160, 255, 190, 50, 30, 255, 220, 210, 100, 255] },
        { name: "slope, offset, power and saturation", xml: '<ColorCorrectionCollection><ColorCorrection><SOPNode><Slope>1.2 0.5 2</Slope><Offset>0.1 0 -0.05</Offset><Power>2 1 0.5</Power></SOPNode><SATNode><Saturation>0.5</Saturation></SATNode></ColorCorrection></ColorCorrectionCollection>', expected: [23, 29, 123, 255, 86, 87, 185, 255, 165, 52, 94, 255, 230, 155, 211, 255] },
    ])(`${mode}: -cdl reads a relative XML grade and matches native $name`, async ({ xml, expected }) => {
        const grade = new TextEncoder().encode(xml);
        const argv = ["source.png", "-cdl", "desat.cc", "result.png"];
        const fs = new MemoryFileSystem();
        await fs.mkdir("/images", { recursive: true });
        await fs.writeFile("/images/source.png", source);
        await fs.writeFile("/images/desat.cc", grade);
        const files = new Map([["source.png", source], ["desat.cc", grade]]);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/images", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" ? await fs.readFile("/images/result.png") : files.get("result.png")!;
        // ImageMagick 7.1.2-35: source.png -cdl grade.cc result.png; result.png -depth 8 rgba:-.
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

for (const retained of [false, true]) {
    it(`-cdl preserves 16-bit samples and alpha, retained=${retained}`, async () => {
        const samples = [0x4321, 0x8765, 0xabcd, 0x3456, 0x1234, 0x4567, 0x89ab, 0xcdef];
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)),
            data16: Uint16Array.from(samples), format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
        const grade = new TextEncoder().encode('<ColorCorrectionCollection><ColorCorrection><SOPNode><Slope>1.2 0.5 2</Slope><Offset>0.1 0 -0.05</Offset><Power>2 1 0.5</Power></SOPNode><SATNode><Saturation>0.5</Saturation></SATNode></ColorCorrection></ColorCorrectionCollection>');
        const files = new Map([["/in.png", input], ["/grade.cc", grade]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const result = await runMagickCli(["/in.png", "-cdl", "/grade.cc", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        // ImageMagick 7.1.2-35 Q16-HDRI, PNG output decoded as 16-bit RGBA.
        expect([...decodeImage(output).data16!]).toEqual([21445, 24475, 48578, 13398, 9247, 12563, 40889, 52719]);
    });

    it.each([undefined, "<ColorCorrectionCollection><ColorCorrection>"])(`-cdl rejects missing or malformed XML without replacing output, retained=${retained}: %s`, async xml => {
        const files = new Map([["/in.png", source], ["/out.png", source]]), fs = new MemoryFileSystem();
        if (xml !== undefined) files.set("/grade.cc", new TextEncoder().encode(xml));
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const result = await runMagickCli(["/in.png", "-cdl", "/grade.cc", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(xml === undefined ? "unable to open" : "XML");
        expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(source);
    });
}

it("-cdl charges the XML file to the public command input budget", async () => {
    const grade = new TextEncoder().encode(desaturate), fs = new MemoryFileSystem();
    await fs.writeFile("/source.png", source);
    await fs.writeFile("/grade.cc", grade);
    await fs.writeFile("/out.png", source);
    const args = createCommandArguments(["source.png", "-cdl", "grade.cc", "out.png"]);
    let stderr = "";
    const result = await createMagickCommand({ limits: { maxInputBytes: source.length + grade.length - 1 } }).execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("input byte limit");
    expect(await fs.readFile("/out.png")).toEqual(source);
});
