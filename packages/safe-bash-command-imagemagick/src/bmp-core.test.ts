import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const core = Buffer.from("Qk0yAAAAAAAAABoAAAAMAAAAAwACAAEAGABaqsjmUEY80igAAAAeFPA80ijmUEYAAAA=", "base64");
const rgb = Buffer.from("Qk1OAAAAAAAAADYAAAAoAAAAAwAAAAIAAAABABgAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAWqrI5lBGPNIoAAAAHhTwPNIo5lBGAAAA", "base64");

it("reads CORE dimensions and depth before decoding or allocating pixels", () => {
    expect(readImageMetadata(core)).toMatchObject({ width: 3, height: 2, channels: 3, hasAlpha: false, density: 72 });
    expect(readImageMetadata(core.subarray(0, 26))).toMatchObject({ width: 3, height: 2 });
});

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`converts a CORE BMP to PNG (${mode})`, async () => {
        // Guard decoding against the original enormous dimensions.
        expect(readImageMetadata(core)).toMatchObject({ width: 3, height: 2 });
        const files = new Map<string, Uint8Array>([["/in.bmp", core]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", core);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(decodeImage(output).data).toEqual(decodeImage(rgb).data);
        expect(Array.from(decodeImage(output).data)).toEqual([
            240, 20, 30, 255, 40, 210, 60, 255, 70, 80, 230, 255,
            200, 170, 90, 255, 70, 80, 230, 255, 40, 210, 60, 255
        ]);
    });
}
