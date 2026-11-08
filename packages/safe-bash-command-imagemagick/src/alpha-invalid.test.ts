import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const execution of ["buffered", "retained", "sync"] as const) {
    it.each(["flatten", "invalid"])(`${execution}: rejects alpha mode %s without writing output`, async mode => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#ff000080", "-background", "blue", "-alpha", mode, "out.png"];
        const result = execution === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`Unsupported alpha mode: ${mode}`);
        expect(result.stdout).toBe("");
        expect(result.stdoutBytes).toBeUndefined();
        expect(files.size).toBe(0);
        expect(await filesystem.readdir("/")).toEqual([]);
    });
}

it("magick rejects alpha flatten on PNG stdin without emitting an image", async () => {
    const png = await sharp(new Uint8Array([255, 0, 0, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const args = createCommandArguments(["png:-", "-background", "blue", "-alpha", "flatten", "png:-"]);
    const output: Uint8Array[] = [];
    let stderr = "";
    const context = {
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () { yield png; })(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
        registerCleanup() {}, fs: new MemoryFileSystem(),
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(1);
    expect(stderr).toContain("Unsupported alpha mode: flatten");
    expect(output).toEqual([]);
});
