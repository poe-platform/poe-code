import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { expression: "red;green;blue", expected: "12121278abababee34343478cdcdcdee56565678efefefee", width: 6 },
        { expression: "red", expected: "12121278abababee", width: 2 },
        { expression: "blue,green,red", expected: "56341278efcdabee", width: 2 },
        { expression: " B , G ; A ", expected: "56345678efcdefee78787878eeeeeeee", width: 4 },
    ])(`extracts channels in ${mode}: $expression`, async ({ expression, expected, width }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#12345678", "xc:#abcdefee", "+append", "xc:white", "-channel-fx", expression, "+append", "PNG32:/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, 1]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
    it(`preserves 16-bit samples and alpha in ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAAEUlEQVQI12MQMnFNr5jVwAgAClUChnqUAgUAAAAASUVORK5CYII=", "base64");
        files.set("/input.png", input);
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-channel-fx", "red;blue,green,red", "+append", "-depth", "16", "PNG64:/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data16!]).toEqual([0x1234, 0x1234, 0x1234, 0x8001, 0x789a, 0x4567, 0x1234, 0x8001]);
    });
}
