import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([undefined, "4", "10"])(`uses six significant digits only when writing MIFF (${mode}, precision=%s)`, async precision => {
        const input = Buffer.concat([Buffer.from("P6\n8 5\n255\n"), Uint8Array.from({ length: 120 }, (_, i) => (13 * i + 9) % 256)]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-units", "PixelsPerInch", "-density", "12.3456789x98.7654321",
            ...(precision === undefined ? [] : ["-precision", precision]), "-write", "/out.miff", "-format", "%x|%y|%U", "info:"];
        let stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("12.345678899999999|98.765432099999998|PixelsPerInch");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!;
        // ImageMagick 7.1.2-35 Q16-HDRI writes this field independently of -precision.
        expect(new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)))).toContain("resolution=12.3457x98.7654\n");
        expect(runConvertCliSync(["/out.miff", "-format", "%x|%y|%U", "info:"], new Map([["/out.miff", bytes]])))
            .toEqual({ exitCode: 0, stdout: "12.345700000000001|98.7654|PixelsPerInch", stderr: "" });
    });
}
