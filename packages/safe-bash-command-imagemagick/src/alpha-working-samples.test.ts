import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const divided = ["xc:#80402080", "-evaluate", "divide", "7"];
const morph = ["(", "xc:#80402020", ")", "(", "xc:#2080c0c0", ")", "-morph", "2"];
// Native ImageMagick 7.1.2-35 Q16-HDRI raw output, including unchanged controls.
const cases: [string[], string][] = [
    [[...divided, "-alpha", "on"], "125b092e0497125b"],
    [[...divided, "-alpha", "opaque"], "125b092e0497ffff"],
    [[...divided, "-alpha", "remove"], "eef5ee4cedf8ffff"],
    [[...morph, "-alpha", "on"], "8080404020202020606055ab55ab55ab40406b158b358b3520208080c0c0c0c0"],
    [divided, "125b092e0497125b"],
    [["xc:#812345679abc8cde", "-alpha", "on"], "812345679abc8cde"],
    [["xc:#812345679abc8cde", "-alpha", "opaque"], "812345679abcffff"],
    [["xc:#812345679abc8cde", "-alpha", "remove"], "ba309952c846ffff"],
    [morph, "8080404020202020606055ab55ab55ab40406b158b358b3520208080c0c0c0c0"],
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${execution}: preserves working samples for %j`, async (operations, hex) => {
        const argv = [...operations, "-depth", "16", "-endian", "MSB", execution === "command" ? "rgba:-" : "rgba:out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = execution === "command" ? Buffer.concat(chunks)
            : execution === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
