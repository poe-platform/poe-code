import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI renders a fresh sRGB Hough canvas.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["Lab", "sRGB"])(`renders black Hough output in sRGB after %s (${mode})`, async colorspace => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:black", "-colorspace", colorspace, "-background", "black", "-hough-lines", "1x1+3", "-depth", "8", "-write", "rgba:/pixels", "-format", "%[colorspace] %[fx:r] %[fx:g] %[fx:b]", "info:/report"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const read = async (path: string) => mode === "command" || mode === "retained" ? fs.readFile(path) : files.get(path)!;
        expect(Buffer.from(await read("/pixels")).toString("hex")).toBe("000000ff".repeat(6));
        expect(new TextDecoder().decode(await read("/report"))).toBe("sRGB 0 0 0");
    });
}
