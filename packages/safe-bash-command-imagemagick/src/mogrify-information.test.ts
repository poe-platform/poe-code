import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "streamed"] as const)
for (const args of [[], ["-help"], ["-version"], ["--version"], ["-list", "format"]])
it(`reports mogrify information for ${JSON.stringify(args)} (${mode})`, async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const files = new Map([["format", bytes], ["a.png", bytes]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/format", bytes);
    await filesystem.writeFile("/a.png", bytes);
    let stdout = "", stderr = "";
    const argv = ["mogrify", ...args];
    const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, mode === "buffered" ? files : {
        filesystem, cwd: "/", ...(mode === "streamed" ? {
            stdout: { async write(chunk: Uint8Array) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk: Uint8Array) { stderr += new TextDecoder().decode(chunk); } }
        } : {})
    });
    expect(result.exitCode).toBe(args.length ? 0 : 1);
    stdout += result.stdout;
    stderr += result.stderr;
    expect(stdout).toContain(args.includes("format") ? "PNG" : args.some(arg => arg.includes("version")) ? "Version: ImageMagick" : "Usage: mogrify");
    expect(stderr).toBe(args.length ? "" : "mogrify: missing required argument\n");
    if (mode === "streamed") expect(result.stdout + result.stderr).toBe("");
    expect([...files.keys()]).toEqual(["format", "a.png"]);
    expect(files.get("format")).toEqual(bytes);
    expect(await filesystem.readdir("/")).toEqual([{ name: "a.png", type: "file" }, { name: "format", type: "file" }]);
    expect(await filesystem.readFile("/format")).toEqual(bytes);
    expect(await filesystem.readFile("/a.png")).toEqual(bytes);
});
