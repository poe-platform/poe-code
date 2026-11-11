import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const original = "0a141eff5a6e82ff";
// ImageMagick 7.1.2-35 Q16-HDRI, default edge pixels, converted back to sRGB.
const cases: { space: string; operation: string[]; expected: string }[] = [
    { space: "HSL", blur: "1b2d40ff3e556cff", gaussian: "1a2d3fff3e556cff" },
    { space: "Lab", blur: "1f2b37ff425364ff", gaussian: "1f2b37ff435364ff" },
    { space: "CMYK", blur: "19293aff3d5166ff", gaussian: "192939ff3d5267ff" },
    { space: "sRGB", blur: "202d3aff445566ff", gaussian: "202d39ff445567ff" }
].flatMap(({ space, blur, gaussian }) => [
    { space, operation: [], expected: original },
    { space, operation: ["-blur", "1x1"], expected: blur },
    { space, operation: ["-gaussian-blur", "1x1"], expected: gaussian }
]);

for (const [space, channel, blur, gaussian] of [
    ["Lab", "R", "222b35ff3f5366ff", "212a35ff405467ff"],
    ["CMYK", "R", "0d141eff4d6e82ff", "0d141eff4d6e82ff"],
    ["CMYK", "K", "13273aff475666ff", "132639ff475767ff"]
] as const) {
    cases.push(
        { space, operation: ["-channel", channel, "-blur", "1x1"], expected: blur },
        { space, operation: ["-channel", channel, "-gaussian-blur", "1x1"], expected: gaussian }
    );
}

for (const mode of ["buffered", "sync", "retained", "magick"] as const) {
    it.each(cases)(`${mode}: blurs working $space with $operation`, async ({ space, operation, expected }) => {
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
