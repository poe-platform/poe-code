import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for red, muted green and blue.
const cases: Array<{ input?: string; space: string; args: string[]; hex: string | undefined; png?: boolean }> = [
    { input: "xc:#80562360", space: "Jzazbz", args: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "80562360" },
    { input: "xc:#80562360", space: "Jzazbz", args: ["PNG32:/out"], hex: "80562360", png: true },
    { input: "xc:black", space: "Jzazbz", args: ["-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "000000" },
    { input: "xc:white", space: "Jzazbz", args: ["-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ffffff" },
    ...[["R", "020202010101030303"], ["G", "8484847f7f7f7b7b7b"], ["B", "8282827e7e7e848484"]].map(([channel, hex]) => ({
        space: "Jzazbz", args: ["-channel", channel!, "-separate", "-depth", "8", "rgb:/out"], hex,
    })),
    { space: "Jzazbz", args: ["-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
    { space: "jZaZbZ", args: ["-colorspace", "JZAZBZ", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
    { space: "Jzazbz", args: ["PNG32:/out"], hex: "ff0000ff208040ff0000ffff", png: true },
    { space: "Jzazbz", args: ["-format", "%[colorspace]", "info:/out"], hex: "4a7a617a627a" },
    { space: "sRGB", args: ["-channel", "R", "-separate", "-depth", "8", "rgb:/out"], hex: "ffffff202020000000" },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native $space working pixels (${mode}): $args`, async ({ space, args: operations, hex, png, input }) => {
        const args = [input ?? "/in.ppm", "-colorspace", space, ...operations];
        const files = new Map([["/in.ppm", new Uint8Array(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex"))], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(png ? decodeImage(output).data : output).toString("hex")).toBe(hex);
    });
}
