import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Array.from({ length: 12 }, (_, j) => [
    (31 * j + 20) % 256, (73 * j + 80) % 256, (47 * j + 13) % 256, [0, 96, 160, 255][j % 4]!
]).flat());

// ImageMagick 7.1.2-35 Q16-HDRI storage classes and raw 8-bit RGBA hashes.
const cases = [
    { type: "PaletteAlpha", operation: [], output: "info:/out", expected: "PseudoClass sRGB Alpha|4x3+0+0" },
    { type: "PaletteAlpha", operation: ["-swirl", "160"], output: "info:/out", expected: "DirectClass sRGB Alpha|4x3+0+0" },
    { type: "PaletteAlpha", operation: ["-implode", ".7"], output: "info:/out", expected: "DirectClass sRGB Alpha|4x3+0+0" },
    { type: "PaletteAlpha", operation: ["-swirl", "160"], output: "rgba:/out", expected: "689411d86f5f4a8d30462c1e731583b6dfed943d2a218cc0aeb08c813b8e59a2" },
    { type: "PaletteAlpha", operation: ["-swirl", "160", "-cycle", "1"], output: "rgba:/out", expected: "9f8d4825a8b2cb01c4ddc0846765d9d850f037b492a4a349e42971f81dd52a2f" },
    { type: "PaletteAlpha", operation: ["-implode", ".7", "-cycle", "1"], output: "rgba:/out", expected: "904b697be69eec3aa73583dc45c9a2f91128149a192778d7b2df5d1705637dfe" },
    { type: "TrueColorAlpha", operation: ["-swirl", "160", "-cycle", "1"], output: "rgba:/out", expected: "9f8d4825a8b2cb01c4ddc0846765d9d850f037b492a4a349e42971f81dd52a2f" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: $type $operation $output`, async ({ type, operation, output, expected }) => {
        const files = new Map([["/in.raw", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["-size", "4x3", "-depth", "8", "rgba:/in.raw", "-type", type, ...operation,
            ...(output.startsWith("info:") ? ["-format", "%r|%g"] : ["-depth", "8"]), output];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        if (output.startsWith("info:")) expect(new TextDecoder().decode(bytes)).toBe(expected);
        else {
            expect(bytes.byteLength).toBe(48);
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
        }
    });
}
