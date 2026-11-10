import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "mogrify"] as const) {
    it.each([
        { geometry: "1x1+1+0", operations: ["-negate", "+region"], expected: [255, 0, 0, 255, 255, 255, 0, 255] },
        { geometry: "1x1+0+0", operations: ["-negate", "+region"], expected: [0, 255, 255, 255, 0, 0, 255, 255] },
        { geometry: "1x1+1+0", operations: ["-negate", "+region", "-negate"], expected: [0, 255, 255, 255, 0, 0, 255, 255] },
        { geometry: "1x1+0+0", operations: ["-negate", "-negate"], expected: [255, 0, 0, 255, 0, 0, 255, 255] },
        { geometry: "2x1+1+0", operations: ["-negate"], expected: [255, 0, 0, 255, 255, 255, 0, 255] },
        { geometry: "2x1-1+0", operations: ["-negate"], expected: [0, 255, 255, 255, 0, 0, 255, 255] },
    ])(`limits edits to the region in ${mode}: $geometry $operations`, async ({ geometry, operations, expected }) => {
        // Native fixture: magick xc:red xc:blue +append -strip PNG24:-
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-region", geometry, ...operations];
        const args = ["/input.png", ...options, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "mogrify" ? await filesystem.readFile("/input.png") : mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

it("keeps region placement across retained frame-cache and chunk boundaries", async () => {
    const filesystem = new MemoryFileSystem();
    const args = ["-size", "4098x2", "xc:red", "-gravity", "southeast", "-region", "1x1+1+0", "-duplicate", "33", "-negate", "+region", "-delete", "0-32", "-depth", "8", "rgba:/out.rgba"];
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const output = await filesystem.readFile("/out.rgba");
    expect(output.length).toBe(4098 * 2 * 4);
    const expected = new Uint8Array(output.length);
    for (let offset = 0; offset < expected.length; offset += 4) expected.set([255, 0, 0, 255], offset);
    expected.set([0, 255, 255, 255], (4098 + 4096) * 4);
    expect(output).toEqual(expected);
});

it("supports region through the public magick command", async () => {
    const filesystem = new MemoryFileSystem();
    const args = createCommandArguments(["xc:red", "-alpha", "on", "xc:blue", "-alpha", "on", "+append", "-channel", "RGB", "-region", "1x1+1+0", "-negate", "+region", "/out.png"]);
    let stderr = "";
    expect(await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    })).toMatchObject({ exitCode: 0 });
    expect(stderr).toBe("");
    expect([...decodeImage(await filesystem.readFile("/out.png")).data]).toEqual([255, 0, 0, 255, 255, 255, 0, 255]);
});
