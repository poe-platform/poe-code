import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "mogrify"] as const) {
    it.each([
        { expression: "red=>blue", expected: [255, 0, 255, 255, 0, 0, 0, 255] },
        { expression: "R => G, G => B", expected: [255, 255, 0, 255, 0, 0, 0, 255] },
        { expression: "blue=>alpha", expected: [255, 0, 0, 0, 0, 0, 255, 255] },
        { expression: "alpha=>green", expected: [255, 255, 0, 255, 0, 255, 255, 255] },
    ])(`copies original channel samples in ${mode}: $expression`, async ({ expression, expected }) => {
        // Native: magick xc:red xc:blue +append -strip PNG24:-
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-channel-fx", expression];
        const args = ["/input.png", ...options, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "mogrify" ? await filesystem.readFile("/input.png") : mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

for (const retained of [false, true]) {
    it.each(["", "red", "red=>", "red=>unknown", "red=>blue=>green", "red=>blue,"])(`rejects invalid assignment %s without overwriting output, retained=${retained}`, async expression => {
        const original = new Uint8Array([1, 2, 3]), files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli(["xc:red", "-channel-fx", expression, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("channel-fx");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

for (const retained of [false, true]) {
    it(`preserves 16-bit samples, retained=${retained}`, async () => {
        // Native: magick 'xc:#123456789abc' -depth 16 -strip PNG48:-
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAIAAADA54+dAAAAD0lEQVQI12MQMgmrmLUHAAYnAmsGA8PKAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const result = await runConvertCli(["/input.png", "-channel-fx", "red=>blue", "-depth", "16", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data16!]).toEqual([0x1234, 0x5678, 0x1234, 65535]);
    });
}

it("copies across retained chunk boundaries", async () => {
    const filesystem = new MemoryFileSystem();
    expect(await runConvertCli(["-size", "4097x1", "xc:red", "-channel-fx", "red=>blue", "rgba:/out.rgba"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const output = await filesystem.readFile("/out.rgba");
    expect(output.length).toBe(4097 * 4);
    for (let offset = 0; offset < output.length; offset += 4) expect([...output.subarray(offset, offset + 4)]).toEqual([255, 0, 255, 255]);
});
