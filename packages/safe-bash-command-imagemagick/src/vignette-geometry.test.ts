import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "retained", "sync"] as const)("rejects non-geometry vignette arguments without writing output (%s)", async mode => {
    for (const geometry of ["junk", "0x1junk", "NaN", "", " "]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "20x16", "xc:#3060a080", "-vignette", geometry, "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, geometry).toBe(1);
        expect(result.stderr).toContain("invalid argument for option '-vignette'");
        expect(files.has("/output.png")).toBe(false);
        await expect(filesystem.readFile("/output.png")).rejects.toMatchObject({ code: "ENOENT" });
    }
});
