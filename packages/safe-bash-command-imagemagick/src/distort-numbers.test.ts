import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each(["z", "0z", "NaN", "Infinity"])("rejects nonnumeric distortion coefficient %s without replacing output", async coefficient => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runMagickCli(["-size", "10x8", "gradient:red-blue", "-filter", "point", operator, "PerspectiveProjection", `1,0,0,0,1,0,${coefficient},0`, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("invalid list of numbers");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});

