import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it("rejects magick -size 1x1 xc:red -depth 8 rgba:- without emitting PNG bytes", async () => {
    const stdout: number[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["-size", "1x1", "xc:red", "-depth", "8", "rgba:-"]).args,
        cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(...bytes); } },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toContain("unsupported output coder 'rgba'");
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["rgba:-", "RGBA:out.png", "rgba:out.raw"])(`${mode}: rejects %s and preserves existing files`, async target => {
        const original = Uint8Array.of(1, 2, 3);
        const files = new Map([["out.png", original], ["out.raw", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        await filesystem.writeFile("/out.raw", original);
        const args = ["-size", "1x1", "xc:red", "-depth", "16", target];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "magick: unsupported output coder 'rgba'\n" });
        expect([...files]).toEqual([["out.png", original], ["out.raw", original]]);
        expect(await filesystem.readFile("/out.png")).toEqual(original);
        expect(await filesystem.readFile("/out.raw")).toEqual(original);
        expect((await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(["out.png", "out.raw"]);
    });

    it(`${mode}: rejects intermediate rgba writes`, async () => {
        const args = ["-size", "1x1", "xc:red", "-write", "rgba:out.raw", "out.png"];
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "magick: unsupported output coder 'rgba'\n" });
        expect(files.size).toBe(0);
        expect(await filesystem.readdir("/")).toEqual([]);
    });
}
