import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const existing of [false, true]) {
        it.each(["1/2", "1,2", "2x1oops", "garbage", "2x1+1junk", ""])(`rejects invalid splice %s without writing, ${mode}, existing=${existing}`, async geometry => {
            const original = Uint8Array.of(1, 2, 3);
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            if (existing) {
                files.set("out.png", original);
                await filesystem.writeFile("/out.png", original);
            }
            const args = ["-size", "5x4", "xc:#204060", "-background", "red", "-splice", geometry, "out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain(
                geometry === "1/2" || geometry === "1,2" ? "invalid geometry" : "invalid argument for option '-splice'");
            const output = mode === "retained" || mode === "command"
                ? await filesystem.readFile("/out.png").catch(() => undefined) : files.get("out.png");
            expect(output).toEqual(existing ? original : undefined);
        });
    }

    it.each([
        { geometry: "1.5x2.5+1+1", size: "5x4", dimensions: [7, 7] },
        { geometry: "1:2", size: "4x3", dimensions: [6, 6] },
        { geometry: "2x1/2", size: "4x3", dimensions: [8, 6] },
        { geometry: "2x1,2", size: "4x3", dimensions: [6, 4] },
    ])(`accepts valid splice $geometry, ${mode}`, async ({ geometry, size, dimensions }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", size, "xc:#204060", "-background", "red", "-splice", geometry, "out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual(dimensions);
    });
}
