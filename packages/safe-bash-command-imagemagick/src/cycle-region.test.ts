import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including both region and alpha controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: ["-region", "2x1+1+0", "-cycle", "1"], expected: "831e5affa010100020a0400020a040ff0a1478ff603020ff831e5aff640a0aff" },
        { operations: ["-region", "2x1+1+0", "-cycle", "1", "+region"], expected: "831e5affa01010ff20a040ff20a040ff0a1478ff603020ff831e5aff640a0aff" },
        { operations: ["-alpha", "opaque", "-region", "2x1+1+0", "-cycle", "1"], expected: "d03090ff1020c000a010100020a040ff1020c0ff603020ffd03090ffa01010ff" },
        { operations: ["-cycle", "1"], expected: "603020ffa01010ff20a040ff2070b0ffd03090ff20a040ff603020ff1020c0ff" },
    ])(`${mode}: matches native first palette cycle for $operations`, async ({ operations, expected }) => {
        const input = Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex");
        const files = new Map<string, Uint8Array>([["/in.raw", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["-size", "4x2", "-depth", "8", "rgba:/in.raw", ...operations, "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
