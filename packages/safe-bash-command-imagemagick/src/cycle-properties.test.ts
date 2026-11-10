import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const four = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
const three = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAADElEQVR4nGNgYGQCAAAIAAQ24LCmAAAAAElFTkSuQmCC", "base64");
const palette = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI shifts width 4 by one and width 3 by zero.
    it.each([
        { argument: "%[fx:w-3]", input: four, expected: [1, 2, 3, 0] },
        { argument: "%[fx:w-3]", input: three, expected: [0, 1, 2] },
        { argument: "%n", input: four, expected: [1, 2, 3, 0] },
        { argument: "%w", input: four, expected: [0, 1, 2, 3] },
        { argument: "%s", input: four, expected: [0, 1, 2, 3] },
        { argument: "%[fx:w]", input: four, expected: [0, 1, 2, 3] },
        { argument: "1", input: four, expected: [1, 2, 3, 0] },
        { argument: "%[w]", input: four, expected: [0, 1, 2, 3] },
        { argument: "%[shift]", input: four, expected: [1, 2, 3, 0] },
        { argument: "%[option:shift]", input: four, expected: [1, 2, 3, 0] },
        { argument: "%[image-shift]", input: four, expected: [3, 0, 1, 2] },
        { argument: "%[bad-shift]", input: four, expected: undefined }
    ])(`${mode} expands -cycle $argument against the current image ($expected)`, async ({ argument, input, expected }) => {
        const keep = Buffer.from("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const options = ["-set", "option:shift", "1", "-set", "image-shift", "-1", "-set", "bad-shift", "invalid", "-cycle", argument];
        const args = ["/in.png", ...options, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png");
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(expected ? 0 : 1);
        if (expected) expect([...decodeImage(output).data]).toEqual(expected.flatMap(index => palette[index]!));
        else expect([...output]).toEqual([...keep]);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode} evaluates cycle shifts separately for every image in a stack`, async () => {
        const files = new Map<string, Uint8Array>([["/four.png", four], ["/three.png", three]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/four.png", "/three.png", "-cycle", "%[fx:w-3]", "+append", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([1, 2, 3, 0, 0, 1, 2].flatMap(index => palette[index]!));
    });
}

it.each([
    ["%n", "34cc53ff2053eafffbcd20fff00a21ff"],
    ["%w", "f00a21ff34cc53ff2053eafffbcd20ff"],
    ["%s", "f00a21ff34cc53ff2053eafffbcd20ff"],
    ["%[fx:w]", "f00a21ff34cc53ff2053eafffbcd20ff"],
    ["1", "34cc53ff2053eafffbcd20fff00a21ff"]
])("matches native raw RGBA output for -cycle %s", async (argument, expected) => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/p.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64"));
    await filesystem.writeFile("/out", Buffer.from("KEEP"));
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["p.png", "-cycle", argument, "-depth", "8", "rgba:out"]).args,
        cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(await filesystem.readFile("/out")).toString("hex")).toBe(expected);
});
