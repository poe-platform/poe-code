import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const option of ["write-mask", "clip-mask"]) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it.each([
            { mask: [0, 255], operations: ["-negate", "+write-mask"], expected: [0, 255, 255, 255, 0, 0, 255, 255] },
            { mask: [255, 0], operations: ["-negate", "+write-mask"], expected: [255, 0, 0, 255, 255, 255, 0, 255] },
            { mask: [0, 255], operations: ["+write-mask", "-negate"], expected: [0, 255, 255, 255, 255, 255, 0, 255] },
            { mask: [0, 255], operations: ["-negate", "-negate", "+write-mask"], expected: [255, 0, 0, 255, 0, 0, 255, 255] },
            { mask: [128, 128], operations: ["-negate", "+write-mask"], expected: [128, 127, 127, 255, 127, 127, 128, 255] },
        ])(`applies ${option} in ${mode}: $mask $operations`, async ({ mask, operations, expected }) => {
            // Native: magick xc:red xc:blue +append -strip PNG24:-
            const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");
            const maskBytes = await sharp(Uint8Array.from(mask.flatMap(value => [value, value, value, 255])), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["/input.png", input], ["/mask.png", maskBytes]]), filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/input.png", `-${option}`, "/mask.png", ...operations.map(token => token.replace("write-mask", option)), "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect([...decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
        });

        it(`fails without replacing output for a missing ${option} in ${mode}`, async () => {
            const files = new Map([["/out.png", Uint8Array.of(42)]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out.png", Uint8Array.of(42));
            const args = ["xc:red", `-${option}`, "/missing.png", "-negate", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("/missing.png");
            expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(Uint8Array.of(42));
        });
    }

    for (const command of ["magick", "mogrify"] as const) {
        it(`supports ${option} through ${command}`, async () => {
            const filesystem = new MemoryFileSystem();
            const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");
            await filesystem.writeFile("/input.png", input);
            const mask = await sharp(Uint8Array.from([0, 0, 0, 255, 255, 255]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
            await filesystem.writeFile("/mask.png", mask);
            const options = [`-${option}`, "/mask.png", "-negate", `+${option}`];
            if (command === "mogrify") {
                expect(await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
            } else {
                const args = createCommandArguments(["/input.png", ...options, "/input.png"]);
                let stderr = "";
                expect(await createMagickCommand().execute({
                    command, args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                })).toMatchObject({ exitCode: 0 });
                expect(stderr).toBe("");
            }
            expect([...decodeImage(await filesystem.readFile("/input.png")).data]).toEqual([0, 255, 255, 255, 0, 0, 255, 255]);
        });
    }

}

it("retains masks across frame-cache and pixel-chunk boundaries", async () => {
    const filesystem = new MemoryFileSystem();
    const args = ["-size", "4097x2", "xc:red", "-write-mask", "xc:white", "-duplicate", "33", "-negate", "+write-mask", "-delete", "0-32", "-depth", "8", "rgba:/out.rgba"];
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const output = await filesystem.readFile("/out.rgba");
    expect(output.length).toBe(4097 * 2 * 4);
    for (let offset = 0; offset < output.length; offset += 4) expect([...output.subarray(offset, offset + 4)]).toEqual([255, 0, 0, 255]);
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([false, true])(`clips color edits with grayscale coverage in ${mode}, remove=%s`, async remove => {
        const input = await sharp(Uint8Array.from([20, 80, 180, 150, 70, 40, 40, 160, 80]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
        const mask = await sharp(Uint8Array.from([0, 0, 0, 128, 128, 128, 255, 255, 255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/mask.png", mask]]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", "-clip-mask", "/mask.png", "-negate", ...(remove ? ["+clip-mask"] : []), "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect([...decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data]).toEqual([235, 175, 75, 255, 128, 127, 127, 255, 40, 160, 80, 255]);
    });
}
