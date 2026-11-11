import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: a comma ends the offsets, even inside parentheses.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "(+1,+1)", expected: "1e0a143c2832" },
        { geometry: "( +1 , +1 )", expected: "1e0a143c2832" },
        { geometry: "+1,+1", expected: "1e0a143c2832" },
        { geometry: "+1+0", expected: "1e0a143c2832" },
        { geometry: "(+1+1)", expected: "3c28321e0a14" },
    ])(`preserves native roll pixels for $geometry, ${mode}`, async ({ geometry, expected }) => {
        const input = Uint8Array.from([10, 20, 30, 40, 50, 60]);
        const files = new Map([["in.bin", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.bin", input);
        const args = ["-size", "3x2", "-depth", "8", "gray:in.bin", "-roll", geometry, "-depth", "8", "gray:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
