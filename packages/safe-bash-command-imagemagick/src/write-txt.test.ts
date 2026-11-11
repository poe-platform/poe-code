import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI: -size 3x2 xc:red -format '%wx%h' -depth 8
// -write txt:report.txt -negate rgb:end.raw (also +write).
const enumeration = "# ImageMagick pixel enumeration: 3,2,0,255,srgb\n" +
    "0,0: (255,0,0)  #FF0000  red\n" +
    "1,0: (255,0,0)  #FF0000  red\n" +
    "2,0: (255,0,0)  #FF0000  red\n" +
    "0,1: (255,0,0)  #FF0000  red\n" +
    "1,1: (255,0,0)  #FF0000  red\n" +
    "2,1: (255,0,0)  #FF0000  red\n";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(["-write", "+write"].flatMap(option =>
        ["txt:report.txt", "report.TXT", "txt:-"].map(output => ({ option, output }))
    ))(`writes pixel enumeration and continues processing: $option $output (${mode})`, async ({ option, output }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:red", "-format", "%wx%h", "-depth", "8", option, output, "-negate", "rgb:end.raw"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toEqual({ exitCode: 0, stdout: output === "txt:-" ? enumeration : "", stderr: "" });
        const buffered = mode === "buffered" || mode === "sync";
        const report = output === "report.TXT" ? output : "report.txt";
        expect(buffered ? [...files.keys()].sort() : (await fs.readdir("/")).map(entry => entry.name).sort())
            .toEqual(output === "txt:-" ? ["end.raw"] : ["end.raw", report]);
        if (output !== "txt:-") expect(new TextDecoder().decode(buffered ? files.get(report) : await fs.readFile("/" + report))).toBe(enumeration);
        expect([...(buffered ? files.get("end.raw")! : await fs.readFile("/end.raw"))])
            .toEqual(Array.from({ length: 6 }, () => [0, 255, 255]).flat());
    });
}

it.each([false, true])("preserves sequence order, alpha, and the depth at the write retained=%s", async retained => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const input = retained ? { filesystem, cwd: "/" } : files;
    const images = ["xc:#12345680", "xc:#abcdef40", "-depth", "16"];
    const expected = await runConvertCli([...images, "txt:-"], new Map());
    expect(expected.exitCode).toBe(0);
    expect(expected.stdout).toContain("1,1,0,65535,srgba");
    expect(await runConvertCli([...images, "-format", "%wx%h", "-write", "txt:report.txt", "-depth", "8", "-channel", "RGB", "-negate", "rgba:end.raw"], input))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(retained ? await filesystem.readFile("/report.txt") : files.get("report.txt"))).toBe(expected.stdout);
    expect([...(retained ? await filesystem.readFile("/end.raw") : files.get("end.raw")!)])
        .toEqual([237, 203, 169, 128, 84, 50, 16, 64]);
});
