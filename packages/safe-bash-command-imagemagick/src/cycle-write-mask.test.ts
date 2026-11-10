import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the first cycle clips palette conversion before disabling alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { colors: ["#ffeedd80", "#01030560", "#102040ff"], operations: ["-write-mask", "/mask.pgm", "-cycle", "0", "+write-mask"], expected: "ffeeddff000102ff102040ff" },
        { colors: ["#ffeedd80", "#01030560", "#102040ff"], operations: ["-write-mask", "/mask.pgm", "-cycle", "1", "+write-mask"], expected: "010305ff000102ff102040ff" },
        { colors: ["#ffeedd80", "#01030560", "#102040ff"], operations: ["-write-mask", "/mask.pgm", "-cycle", "2", "+write-mask"], expected: "102040ff000102ff102040ff" },
        { colors: ["#ffeedd80", "#01030560", "#102040ff"], operations: ["-cycle", "1"], expected: "010305ff102040ffffeeddff" },
        { colors: ["white", "black", "gray"], operations: ["-write-mask", "/mask.pgm", "-cycle", "1", "+write-mask"], expected: "000000ff000000ff7e7e7eff" },
    ])(`${mode}: matches native first masked palette cycle for $colors $operations`, async ({ colors, operations, expected }) => {
        const mask = Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([0, 255, 255])]);
        const files = new Map<string, Uint8Array>([["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = [...colors.map(color => `xc:${color}`), "+append", ...operations, "-depth", "8", "rgba:/out"];
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
