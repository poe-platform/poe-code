import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, P5 6x5 input with gray bytes i * 8.
const cases = [
    { page: "", geometry: "2x2+1+2:3", output: "info", expected: "1x2|1x2+0+0", warns: false },
    { page: "", geometry: "2x2+1+2:3", output: "gray", expected: "0030", warns: false },
    { page: "4x3-1+4", geometry: "2x2+1+2/3", output: "gray", expected: "b0b8e0e8", warns: false },
    { page: "", geometry: "2x2+1+2/3", output: "gray", expected: "0008101820283038404850586068707880889098a0a8b0b8c0c8d0d8e0e8", warns: true },
    { page: "", geometry: "2x2+1+2", output: "gray", expected: "0018202830485058c0d8e0e8", warns: false },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`resolves chop $geometry on page '$page' for $output (${mode})`, async ({ page, geometry, output, expected, warns }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n6 5\n255\n"), ...Array.from({ length: 30 }, (_, i) => i * 8)]);
        const files = new Map([["/in.pgm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.pgm", ...(page ? ["-repage", page] : []), "-chop", geometry,
            ...(output === "info" ? ["-format", "%wx%h|%g"] : ["-depth", "8"]), `${output}:/out`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output === "info" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
    });
}
