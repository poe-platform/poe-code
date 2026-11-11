import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output.
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["associate", "disassociate"] as const) it.each([
        { selection: ["-channel", "R"], associate: "093456ff", disassociate: "243456ff" },
        { selection: ["-channel", "G"], associate: "121a56ff", disassociate: "126856ff" },
        { selection: ["-channel", "B"], associate: "12342bff", disassociate: "1234abff" },
        { selection: ["-channel", "RG"], associate: "091a56ff", disassociate: "246856ff" },
        { selection: ["-channel", "A"], associate: "123456ff", disassociate: "123456ff" },
        { selection: [], associate: "091a2bff", disassociate: "2468abff" },
        { selection: ["-channel", "R", "+channel"], associate: "091a2bff", disassociate: "2468abff" },
    ])(`${execution}: alpha ${operation} with $selection`, async ({ selection, ...expected }) => {
        const argv = ["xc:#12345680", ...selection, "-alpha", operation, "+channel", "-depth", "8", "rgba:out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = execution === "command" || execution === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex"), operation).toBe(expected[operation]);
    });
}
