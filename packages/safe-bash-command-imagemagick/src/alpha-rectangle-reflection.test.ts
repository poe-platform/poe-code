import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: copying pixels clears disassociated
// alpha's separate-channel trait, even for identity geometry.
const operators = [
    ["-splice", "0x0"], ["-chop", "0x0"], ["-roll", "+0+0"],
    ["-flip"], ["-flop"], ["-transpose"], ["-transverse"]
];
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...operators.map(operator => ({ operator, alpha: "Disassociate", expected: 0 })),
        ...operators.map(operator => ({ operator, alpha: "On", expected: 0x60 })),
        ...operators.map(operator => ({ operator, alpha: "Discrete", expected: 0x60 })),
        { operator: [], alpha: "Disassociate", expected: 0x60 },
        { operator: ["-swirl", "0"], alpha: "Disassociate", expected: 0 }
    ])(`${execution}: alpha $alpha through $operator`, async ({ operator, alpha, expected }) => {
        const argv = ["xc:#80402060", "-alpha", alpha, ...operator,
            "-channel", "A", "-separate", "+channel", "-depth", "8", "gray:out"];
        const keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["out", keep]]);
        await fs.writeFile("/out", keep);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect([...(execution === "command" || execution === "retained" ? await fs.readFile("/out") : files.get("out")!)]).toEqual([expected]);
    });
}
