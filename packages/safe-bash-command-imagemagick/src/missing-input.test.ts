import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operands of [
        ["missing.png", "r.png", "r.png"],
        ["r.png", "missing.png", "r.png"],
        ["r.png", "r.png", "missing.png"],
        ["r.png", "-write", "before.png", "missing.png", "-write", "after.png"],
        ["--", "r.png", "missing.png"],
        ["r.png", "(", "missing.png", ")"],
    ]) {
        it(`${mode}: stops at missing input in ${operands.join(" ")}`, async () => {
            const files = new Map<string, Uint8Array>();
            runMagickCliSync(["-size", "1x1", "xc:red", "r.png"], files);
            runMagickCliSync(["-size", "1x1", "xc:blue", "b.png"], files);
            const destination = files.get("b.png")!.slice();
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            const args = [...operands, "b.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("missing.png");
            const read = (path: string) => mode === "retained" || mode === "command" ? filesystem.readFile(`/${path}`) : files.get(path);
            expect(await read("b.png")).toEqual(destination);
            if (operands.includes("before.png")) {
                expect([...decodeImage((await read("before.png"))!).data]).toEqual([255, 0, 0, 255]);
                if (mode === "retained" || mode === "command") await expect(read("after.png")).rejects.toMatchObject({ code: "ENOENT" });
                else expect(read("after.png")).toBeUndefined();
            }
        });
    }
}
