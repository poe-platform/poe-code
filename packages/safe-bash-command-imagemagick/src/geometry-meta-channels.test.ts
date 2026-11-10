import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, six distinct pixels in a 3x2 image.
const input = Buffer.from([17, 34, 51, 68, 85, 102].flatMap(value => [value, value, value, 255]));
const operations = [
    { name: "flip", args: ["-flip"], expected: "445566112233" },
    { name: "flop", args: ["-flop"], expected: "332211665544" },
    { name: "wrapped roll", args: ["-roll", "+1+1"], expected: "664455331122" },
    { name: "zero roll", args: ["-roll", "+0+0"], expected: "112233445566" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const channel of ["10", "R"]) {
        it.each(operations)(`${mode}: $name moves channel ${channel}`, async ({ args: operation, expected }) => {
            const files = new Map([["in.raw", input], ["out", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            const args = ["-size", "3x2", "-depth", "8", "rgba:in.raw",
                ...(channel === "10" ? ["rgba:in.raw", "rgba:in.raw", "xc:white", "rgba:in.raw", "-combine"] : []),
                ...operation, "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:out"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
