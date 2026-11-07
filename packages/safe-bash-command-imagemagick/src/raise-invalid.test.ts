import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const option of ["-raise", "+raise"])
    for (const existing of [false, true]) {
        it.each(["oops", "2oops", "2x1junk", ""])(`rejects invalid ${option} %s without writing, ${mode}, existing=${existing}`, async geometry => {
            const original = Uint8Array.of(1, 2, 3);
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            if (existing) {
                files.set("out.png", original);
                await filesystem.writeFile("/out.png", original);
            }
            const args = ["-size", "12x10", "xc:#204060", option, geometry, "out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${option}'`);
            const output = mode === "retained" || mode === "command"
                ? await filesystem.readFile("/out.png").catch(() => undefined) : files.get("out.png");
            expect(output).toEqual(existing ? original : undefined);
        });
    }

}
