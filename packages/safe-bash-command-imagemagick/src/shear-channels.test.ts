import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const pixels = "3060b080a04020e0802050b0c01030607733bb90808020c0";
const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from(pixels, "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI, in.pam <options> -depth 8 rgba:out.
const fullColor = "bdcce6ffa47774ffa9606bffdfc7d3ffe7a5b1ffb28cd9ff9f9f57ffffffffff";
const cases = [
    { name: "red", options: ["-channel", "R", "-shear", "20x0", "+channel"], rgba: "bdffffffa4ffffffa9ffffffdfffffffe7ffffffb2ffffff9fffffffffffffff" },
    { name: "green", options: ["-channel", "G", "-shear", "20x0", "+channel"], rgba: "ffccffffff77ffffff60ffffffc7ffffffa5ffffff8cffffff9fffffffffffff" },
    { name: "alpha", options: ["-channel", "A", "-shear", "20x0", "+channel"], rgba: "ff".repeat(32) },
    { name: "RGB", options: ["-channel", "RGB", "-shear", "20x0", "+channel"], rgba: fullColor },
    { name: "default", options: ["-shear", "20x0"], rgba: fullColor },
    { name: "reset without shear", options: ["-channel", "R", "+channel"], rgba: pixels },
    { name: "identity shear", options: ["-channel", "R", "-shear", "0x0", "+channel"], rgba: pixels }
];

for (const mode of ["command", "sync"] as const) {
    it.each(cases)(`honors $name channels during shear (${mode})`, async ({ options, rgba }) => {
        const keep = Buffer.from("KEEP"), fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", keep]]);
        await fs.writeFile("/in.pam", input);
        await fs.writeFile("/out", keep);
        const args = ["/in.pam", ...options, "-depth", "8", "rgba:/out"];
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
