import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["%n", "21e091e267e2b4b23883716e126bf6de4f555449c45b11d5ccb9cad31c3faaba"],
        ["%[fx:n]", "21e091e267e2b4b23883716e126bf6de4f555449c45b11d5ccb9cad31c3faaba"],
        ["2", "21e091e267e2b4b23883716e126bf6de4f555449c45b11d5ccb9cad31c3faaba"],
        ["1", "476030178dcacd8c56c219f32e0a51180983b832ed6e2a9e76d1bb17191e1ac3"]
    ])(`matches native vignette frame-count inset %s (${mode})`, async (inset, hash) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = ["-size", "6x4", "xc:#3876b4", "xc:#3876b4", "-background", "#d29153", "-vignette", `0x1+${inset}+1`, "+append", "-depth", "8", "rgba:/out"];
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
        // Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 destination bytes.
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
