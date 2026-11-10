import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const option of ["-raise", "+raise"]) {
        for (const beforeInput of [true, false]) {
            it(`${option} requires preceding input, ${mode}, beforeInput=${beforeInput}`, async () => {
                const original = new TextEncoder().encode("KEEP");
                const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/out", original);
                const input = ["-size", "8x6", "xc:#7040b080"], operation = [option, "2x1"];
                const args = [...(beforeInput ? [...operation, ...input] : [...input, ...operation]), "-crop", "2x2+0+0", "-depth", "8", "rgba:out"];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(beforeInput ? 1 : 0);
                if (beforeInput) expect("stderr" in result ? result.stderr : stderr).toContain(`no images found for operation '${option}'`);
                const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
                expect(Buffer.from(output).toString("hex")).toBe(beforeInput ? "4b454550"
                    : option === "-raise" ? "b39ad5bcb39ad5bc9471c4a09471c4a0" : "3b225d443b225d445330835f5330835f");
            });
        }
    }
}
