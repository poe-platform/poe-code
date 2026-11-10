import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "retained", "sync", "magick"])("thresholds fractional deskew samples (%s)", async mode => {
    const header = new TextEncoder().encode("P6\n32 12\n255\n");
    const input = new Uint8Array(header.length + 32 * 12 * 3);
    input.set(header);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) {
        const stripe = x > 2 && x < 29 && Math.abs(y - 3 - Math.floor(x / 8)) <= 1;
        input.set(stripe ? [22, 58, 90] : [235, 221, 243], header.length + (y * 32 + x) * 3);
    }
    for (const [divide, threshold, tilted] of [
        [true, "800", false], [true, "807", false], [true, "750", false],
        [true, "820", true], [false, "5600", false], [false, "5740", true],
        [true, `${800 / 65535 * 100}%`, false], [true, `${820 / 65535 * 100}%`, true]
    ] as const) {
        const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, data] of files) await fs.writeFile("/" + name, data);
        const args = ["in.ppm", ...(divide ? ["-evaluate", "Divide", "7"] : []), "-deskew", threshold,
            "-format", "%wx%h %X,%Y %[deskew:angle]", "info:out"];
        let stderr = "";
        const result = mode === "magick" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        const reference = spawnSync("magick", ["-", ...args.slice(1, -1), "info:"], { input });
        if (!reference.error) {
            expect(reference.status, reference.stderr.toString()).toBe(0);
            expect.soft(new TextDecoder().decode(output), threshold).toBe(reference.stdout.toString());
        }
        expect.soft(new TextDecoder().decode(output), threshold).toBe(tilted ? "35x17 -1,-4 -5.3558250428551908" : "34x14 -1,-1 -0");
    }
});
