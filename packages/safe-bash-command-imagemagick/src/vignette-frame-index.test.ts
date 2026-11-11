import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["%[fx:t]", "b44a6db3eecfbc9d0fdc2c8242e346a0addd1cc9b98be9e256e2b01b7a08260c"],
        ["%[fx:n]", "01a51e1cfa2b4e7e66e748fcff7149251bc73cc15d1b136e8a4ad0996eb6d7aa"],
        ["%[fx:u[1].w/3]", "01a51e1cfa2b4e7e66e748fcff7149251bc73cc15d1b136e8a4ad0996eb6d7aa"],
        ["1", "02f45559a5734be2465bed46c75eee6710e9f639ed98bf585700a40c723e5d38"]
    ])(`matches native vignette frame-index inset %s (${mode})`, async (inset, hash) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = ["-size", "6x4", "xc:#3080a0", "-duplicate", "1", "-background", "white", "-vignette", `0x1+${inset}+0`, "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        // Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 destination bytes.
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
