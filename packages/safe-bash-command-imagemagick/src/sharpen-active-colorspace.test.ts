import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const original = "0a141eff5a6e82ff";
// ImageMagick 7.1.2-35 Q16-HDRI, default edge pixels, converted back to sRGB.
const cases = [
    { space: "HSL", sharpen: "000000ff758290ff" },
    { space: "Lab", sharpen: "000a15ff6e859cff" },
    { space: "CMYK", sharpen: "020507ff768799ff" },
    { space: "sRGB", sharpen: "000007ff6c8299ff" }
].flatMap(({ space, sharpen }) => [
    { space, operation: [], expected: original },
    { space, operation: ["-sharpen", "1x1"], expected: sharpen }
]);

for (const [space, channel, expected] of [
    ["Lab", "R", "000c18ff718599ff"],
    ["HSL", "G", "09141fff626e7aff"],
    ["CMYK", "R", "08141eff656e82ff"],
    ["CMYK", "K", "020507ff6a8199ff"]
] as const) cases.push({ space, operation: ["-channel", channel, "-sharpen", "1x1"], expected });

for (const mode of ["buffered", "sync", "retained", "magick"] as const) {
    it.each(cases)(`${mode}: sharpens working $space with $operation`, async ({ space, operation, expected }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n2 1\n255\n"),
            10, 20, 30, 90, 110, 130
        ]);
        const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["in.ppm", "-colorspace", space, ...operation, "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" ? { ...await createMagickCommand().execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
