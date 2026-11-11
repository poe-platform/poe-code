import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const header = "6661726266656c640000000200000001";
const payload = "1234abcd8001000080011235cdef8000";

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    // Q16-HDRI: farbfeld stores alpha even when pixel blending is disabled.
    it.each([
        ["deactivate", payload],
        ["discrete", payload],
        ["associate", "00000000000000004001091b66f88000"],
        ["disassociate", "ffffffffffff0000ffff246affff8000"],
        ["activate", payload],
        ["off", "1234abcd8001ffff80011235cdefffff"],
        ["opaque", "1234abcd8001ffff80011235cdefffff"],
        ["transparent", "1234abcd8001000080011235cdef0000"]
    ])(`${execution}: farbfeld preserves the alpha state after %s`, async (mode, expected) => {
        const input = Buffer.from(header + payload, "hex");
        const files = new Map<string, Uint8Array>([["/in.ff", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ff", input);
        const argv = ["/in.ff", "-alpha", mode, "-write", "/copy.ff", "ff:-"];
        const args = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const copy = execution === "command" || execution === "retained" ? await fs.readFile("/copy.ff") : files.get("/copy.ff")!;
        const output = execution === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined;
        expect(Buffer.from(copy).toString("hex")).toBe(header + expected);
        expect(output).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(output!).toString("hex")).toBe(header + expected);
    });
}
