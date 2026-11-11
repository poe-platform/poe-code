import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw CMYK reference bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "cmyk(100%,100%,100%,95%)", method: "white", expected: "fffffffffffffdb1" },
        { color: "cmyk(100%,100%,100%,95%)", method: "edge", expected: "fffffffffffff333" },
        { color: "cmyk(50%,50%,50%,46%)", method: "gray", expected: "8000800080007e28" },
        { color: "cmyk(50%,50%,50%,46%)", method: "edge", expected: "80008000800075c3" },
    ])(`${mode}: enhances $color with $method virtual pixels`, async ({ color, method, expected }) => {
        const args = [`xc:${color}`, "-virtual-pixel", method, "-enhance",
            "-depth", "16", "-endian", "MSB", "cmyk:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
