import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: lookups use the source image's channel mask.
const cases = [
    { operation: "-clut", source: ["-channel", "R"], lookup: [], global: [], expected: "52408080" },
    { operation: "-clut", source: ["-channel", "A"], lookup: [], global: [], expected: "20408088" },
    { operation: "-hald-clut", source: ["-channel", "R"], lookup: [], global: [], expected: "df408080" },
    { operation: "-clut", source: [], lookup: [], global: ["-channel", "R"], expected: "52408080" },
    { operation: "-clut", source: [], lookup: ["-channel", "R"], global: [], expected: "526a3688" },
    { operation: "-hald-clut", source: [], lookup: [], global: [], expected: "dfbf7fff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const format of ["rgba", "PNG32"])
it.each(cases)(`${mode} ${format}: $operation source=$source lookup=$lookup global=$global`, async ({ operation, source, lookup, global, expected }) => {
    const argv = ["-respect-parentheses", "(", "xc:#20408080", ...source, ")", "(",
        ...(operation === "-clut" ? ["xc:#10308040", "xc:#e0a020d0", "+append"] : ["hald:2", "-negate"]),
        ...lookup, ")", ...global, operation, "-depth", "8", "-endian", "MSB", `${format}:${mode === "command" ? "-" : "/out"}`];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(format === "rgba" ? bytes : decodeImage(bytes).data).toString("hex")).toBe(expected);
});
