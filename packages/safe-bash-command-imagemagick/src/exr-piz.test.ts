import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "../../../tests/fixtures/media/exr-piz-fixtures.json" with { type: "json" };

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`converts every PIZ gradient pixel like ZIP (${mode})`, async () => {
        const fixture = fixtures.find(fixture => fixture.name === "ramp")!;
        const files = new Map([['/piz.exr', new Uint8Array(Buffer.from(fixture.piz, "base64"))], ['/zip.exr', new Uint8Array(Buffer.from(fixture.zip, "base64"))]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        for (const compression of ["piz", "zip"]) {
            const args = [`/${compression}.exr`, `PNG32:/${compression}.png`];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} }
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
        }
        const read = async (path: string) => mode === "retained" || mode === "command" ? filesystem.readFile(path) : files.get(path)!;
        const actual = decodeImage(await read("/piz.png")), expected = decodeImage(await read("/zip.png"));
        expect([actual.width, actual.height]).toEqual([64, 64]);
        expect(actual.data).toEqual(expected.data);
    });
}

for (const retained of [false, true]) it(`preserves output after malformed PIZ data (retained=${retained})`, async () => {
    const input = Buffer.from(fixtures[0]!.piz, "base64");
    // Locate the first chunk after the attributes and corrupt its bitmap bounds.
    let offset = 8;
    while (input[offset]) {
        offset = input.indexOf(0, offset) + 1;
        offset = input.indexOf(0, offset) + 1;
        offset += 4 + input.readUInt32LE(offset);
    }
    const chunk = Number(input.readBigUInt64LE(offset + 1));
    input.writeUInt16LE(8192, chunk + 10);
    const keep = Uint8Array.of(42), files = new Map([["/in.exr", new Uint8Array(input)], ["/out.png", keep]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const result = await runConvertCli(["/in.exr", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("EXR PIZ");
    expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(keep);
});
