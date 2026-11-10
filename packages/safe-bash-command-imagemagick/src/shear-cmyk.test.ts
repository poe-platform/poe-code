import fixtures from "./shear-cmyk-fixtures.json" with { type: "json" };
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI, followed by -crop 1x1+0+0 +repage -depth 8 rgba:out.
const cases = [
    { name: "sheared black ink", options: ["-colorspace", "CMYK", "-shear", "20x0", "-channel", "K", "-separate"], rgba: "444444ff" },
    { name: "sheared CMYK converted to sRGB", options: ["-colorspace", "CMYK", "-shear", "20x0", "-colorspace", "sRGB"], rgba: "10213cff" },
    { name: "sheared sRGB", options: ["-colorspace", "sRGB", "-shear", "20x0", "-colorspace", "sRGB"], rgba: "bdcce6ff" },
    { name: "unchanged black ink", options: ["-colorspace", "CMYK", "-channel", "K", "-separate"], rgba: "4f4f4fff" },
    { name: "unchanged CMYK converted to sRGB", options: ["-colorspace", "CMYK", "-colorspace", "sRGB"], rgba: "3060b080" },
    { name: "identity shear black ink", options: ["-colorspace", "CMYK", "-shear", "0x0", "-channel", "K", "-separate"], rgba: "4f4f4fff" },
    { name: "identity shear CMYK converted to sRGB", options: ["-colorspace", "CMYK", "-shear", "0x0", "-colorspace", "sRGB"], rgba: "3060b080" }
];

for (const mode of ["command", "sync"] as const) {
    it.each(fixtures)(`matches every native CMYKA sample for $options (${mode})`, async ({ options, hex }) => {
        const files = new Map<string, Uint8Array>([["/in.pam", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", input);
        const args = ["/in.pam", "-colorspace", "CMYK", ...options, "-depth", "8", "cmyka:/out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(hex);
    });
    it.each(cases)(`preserves $name (${mode})`, async ({ options, rgba }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.pam", ...options, "-crop", "1x1+0+0", "+repage", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(rgba);
    });
}
