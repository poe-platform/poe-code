import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

it.each([
    "", "0", "0,0", "0,0 4", "0,0 4,3 10",
    "0,0 4,3 9,0", "0,0 4,3 9,0 13",
    "0,0 4,3 9,0 13,3 0,7 4,10 9",
])("rejects incomplete Affine points %s without replacing output", async points => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runMagickCli(["-size", "10x8", "gradient:red-blue", operator, "Affine", points, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Affine requires complete source/destination point pairs");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});

it.each(["0,0 4,3", "0,0 4,3 9,0 13,3", "0,0 4,3 9,0 13,3 0,7 4,10"])("accepts complete Affine points %s", async points => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", "10x8", "gradient:red-blue", operator, "Affine", points, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!).width).toBeGreaterThan(0);
    }
});

it.each(["0,0 4", "0,0 4,3 10"])("preserves the destination through the public command for %s", async points => {
    const fs = new MemoryFileSystem(), original = new TextEncoder().encode("KEEP");
    await runMagickCli(["-size", "10x8", "gradient:red-blue", "/input.png"], { filesystem: fs, cwd: "/" });
    await fs.writeFile("/out.png", original);
    const argumentValues = createCommandArguments(["/input.png", "-distort", "Affine", points, "/out.png"]);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(1);
    expect(await fs.readFile("/out.png")).toEqual(original);
});
