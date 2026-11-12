import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, P6 5x3 with RGB bytes 0 through 44.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { options: ["-colors", "4"], pixels: "060708".repeat(6) + "1d1e1f".repeat(9) },
        { options: ["+dither", "-colors", "4"], pixels: "0e0f10".repeat(9) + "242526".repeat(6) },
        { options: ["+dither", "-colors", "8"], pixels: "08090a".repeat(5) + "141516".repeat(3) + "1a1b1c".repeat(2) + "1e1f20".repeat(2) + "262728".repeat(3) },
        { options: ["-treedepth", "4", "-colors", "4"], pixels: "0e0f10".repeat(9) + "242526".repeat(6) },
    ])(`matches the low-contrast RGB palette (${mode}): $options`, async ({ options, pixels }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n5 3\n255\n"), ...Array.from({ length: 45 }, (_, i) => i)]);
        const filesystem = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...options, "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(pixels);
    });
}
