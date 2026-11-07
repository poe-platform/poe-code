import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "streamed"]) {
    for (const target of ["-", "out.dat"]) {
        it.each([false, true])(`writes sparse color text to ${target} (${mode}, gray16=%s)`, async gray16 => {
            const data16 = Uint16Array.of(0x1234, 0x1234, 0x1234, 65535, 0x1235, 0x1235, 0x1235, 65535, 65535, 65535, 65535, 65535);
            const bytes = encodeImage({ width: 3, height: 1, format: "png", density: 72, space: gray16 ? "grey16" : "srgb", depth: gray16 ? "ushort" : "uchar", channels: gray16 ? 1 : 4, hasAlpha: !gray16,
                data: gray16 ? Uint8Array.from(data16, value => Math.round(value / 257)) : Uint8Array.of(255, 0, 0, 255, 30, 40, 50, 128, 70, 80, 90, 0),
                ...(gray16 ? { data16 } : {}) }, { format: "png" }).data;
            const expected = gray16 ? "0,0,gray(7.1107%) 1,0,gray(7.11223%) 2,0,gray(255) " : "0,0,srgba(255,0,0,1) ";
            const filesystem = new MemoryFileSystem(), files = new Map([["input.png", bytes]]), chunks: Uint8Array[] = [];
            await filesystem.writeFile("/input.png", bytes);
            const result = await runConvertCli(["input.png", `sparse-color:${target}`], mode === "buffered" ? files : { filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } } } : {}) });
            expect(result).toEqual({ exitCode: 0, stderr: "", stdout: target === "-" && mode !== "streamed" ? expected : "" });
            if (target !== "-") expect(new TextDecoder().decode(mode === "buffered" ? files.get(target) : await filesystem.readFile(`/${target}`))).toBe(expected);
            if (mode === "streamed") expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe(target === "-" ? expected : "");
            expect(mode === "buffered" ? [...files.keys()].sort() : (await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(target === "-" ? ["input.png"] : ["input.png", "out.dat"]);
        });
    }
}

it.each([false, true])("preserves RGB precision and excludes nearly opaque 16-bit pixels (retained=%s)", async retained => {
    const data16 = Uint16Array.of(0x1234, 257, 65535, 65535, 0x1234, 257, 65535, 65534);
    const bytes = encodeImage({ width: 1, height: 2, format: "png", density: 72, space: "srgb", channels: 4, hasAlpha: true, depth: "ushort", data16, data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", bytes);
    expect(await runConvertCli(["input.png", "sparse-color:-"], retained ? { filesystem, cwd: "/" } : new Map([["input.png", bytes]]))).toEqual({ exitCode: 0, stderr: "", stdout: "0,0,srgba(7.1107%,0.392157%,100%,1) " });
});

it.each([false, true])("keeps coordinates across rows and handles empty output (retained=%s)", async retained => {
    const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
    expect(await runConvertCli(["-size", "1x2", "xc:red", "-alpha", "off", "sparse-color:-"], input)).toEqual({ exitCode: 0, stderr: "", stdout: "0,0,srgb(255,0,0) 0,1,srgb(255,0,0) " });
    expect(await runConvertCli(["xc:none", "sparse-color:-"], input)).toEqual({ exitCode: 0, stderr: "", stdout: "" });
});
