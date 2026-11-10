import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels and metadata.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([false, true])(`applies CLAHE in CIELab through ${mode} (metadata=%s)`, async metadata => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append", "-colorspace", "Lab", "-clahe", "2x2+16+2",
            ...(metadata ? ["-format", "%r|%[colorspace]", "info:out"] : ["-colorspace", "sRGB", "-depth", "8", "rgba:out"])];
        let result;
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } } });
            expect(stderr).toBe("");
        } else result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = Buffer.from(mode === "retained" || mode === "public" ? await fs.readFile("/out") : files.get("out")!);
        expect(output.toString(metadata ? "utf8" : "hex")).toBe(metadata ? "DirectClass CIELab Alpha|CIELab" : "9b6e3a60b2ffffa0cface0ea");
    });
}

for (const retained of [false, true]) it(`keeps Lab samples aligned across CLAHE chunks (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const lab of [false, true]) {
        const result = await runConvertCli(["-size", "1040x2", "gradient:#805623-#40a0a0", ...(lab ? ["-colorspace", "Lab"] : []),
            "-clahe", "16x2!+32+3", "-colorspace", "sRGB", "-depth", "8", `rgba:${lab ? "lab" : "rgb"}`],
        retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
    }
    const lab = retained ? await fs.readFile("/lab") : files.get("lab")!;
    const rgb = retained ? await fs.readFile("/rgb") : files.get("rgb")!;
    expect(lab).toEqual(rgb);
});
