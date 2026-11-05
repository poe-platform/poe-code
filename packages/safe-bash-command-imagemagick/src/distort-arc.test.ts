import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

it.each([false, true].flatMap(retained => ["-distort", "+distort"].flatMap(operation =>
    ["Arc", "arc"].map(method => ({ retained, operation, method }))
)))("rejects $operation $method without publishing output, retained=$retained", async ({ retained, operation, method }) => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["out.png", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out.png", original);
    const result = await runConvertCli([
        "-size", "31x31", "xc:black", operation, method, "180", "out.png"
    ], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported distortion method: Arc");
    expect(retained ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(original);
});
