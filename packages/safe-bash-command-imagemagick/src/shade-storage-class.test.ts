import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: shade promotes palette storage without changing sRGB.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([false, true])(`reports native storage class with shade=%s (${mode})`, async shade => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-colors", "2", ...(shade ? ["-shade", "0x45"] : []),
            "-format", "%r|%[type]|%[colorspace]", "-write", "info:/metadata", "-depth", "8", "rgba:/pixels"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const metadata = mode === "command" || mode === "retained" ? await fs.readFile("/metadata") : files.get("/metadata")!;
        const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        expect(new TextDecoder().decode(metadata)).toBe(shade ? "DirectClass sRGB |Grayscale|sRGB" : "PseudoClass sRGB |Palette|sRGB");
        expect(Buffer.from(pixels).toString("hex")).toBe(shade ? "4d4d4dff4d4d4dff" : "0a141eff5a6e82ff");
    });
}
