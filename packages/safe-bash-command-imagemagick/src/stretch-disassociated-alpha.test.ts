import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including PNG32 decoded as RGBA8.
const cases = [
    ...[["-normalize"], ["-contrast-stretch", "0"]].flatMap(operation => [
        { color: "#94ced340", operation: ["-alpha", "Disassociate", ...operation], expected: "000037ff9a9a9aff" },
        { color: "#28482380", operation: ["-alpha", "Disassociate", ...operation], expected: "0000ffff007100ff" },
    ]),
    { color: "#94ced340", operation: ["-alpha", "Disassociate", "-normalize", "-alpha", "Activate"], expected: "000037009a9a9a00" },
    { color: "#94ced340", operation: ["-alpha", "Disassociate", "-normalize", "-alpha", "On"], expected: "000037ff9a9a9aff" },
    { color: "#94ced340", operation: ["-alpha", "Disassociate", "-evaluate", "Add", "0", "-normalize"], expected: "000f7affffffffff" },
    ...[
        { options: ["-channel", "RGB"], expected: "0000ffff8b5f00ff" },
        { options: ["-channel", "R"], expected: "0068abff8b8f46ff" },
        { options: ["-channel", "A"], expected: "2468abff508f46ff" },
    ].map(({ options, expected }) => ({ color: "#28482380", operation: ["-alpha", "Disassociate", ...options, "-normalize"], expected })),
    { color: "#28482380", operation: ["-colorspace", "Gray", "-alpha", "Disassociate", "-normalize"], expected: "000000ff000000ff" },
    { color: "#28482380", operation: ["-colorspace", "CMYK", "-alpha", "Disassociate", "-normalize"], expected: "061127ff0c2706ff" },
    { color: "#94ced340", operation: ["-alpha", "Disassociate", "-evaluate", "Divide", "5"], expected: "071522ff76a4a8ff" },
    { color: "#94ced340", operation: ["-alpha", "off", "-normalize"], expected: "000843ffafffffff" },
    { color: "#94ced340", operation: ["-contrast-stretch", "0"], expected: "0008438cafffff1d" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const coder of ["rgba", "PNG32"]) {
        it.each(cases)(`${mode}: ${coder} stretches $color with $operation`, async ({ color, operation, expected }) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#12345680", `xc:${color}`, "+append", ...operation, "-depth", "8", `${coder}:${mode === "command" ? "-" : "/out"}`];
            const args = createCommandArguments(argv);
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            const pixels = coder === "PNG32" ? decodeImage(bytes).data : bytes;
            expect(Buffer.from(pixels).toString("hex")).toBe(expected);
        });
    }
}
