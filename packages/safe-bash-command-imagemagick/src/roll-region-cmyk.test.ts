import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete raw rasters.
const cases = [
    { format: "cmyk", operations: ["-region", "2x2+1+1", "-roll", "+1-1", "+region"], hex: "13385d82a7ccf1163b6085aacff4193e6388add2b3d8fd22476c91b61f44698eb3d8fd2213385d82a7ccf1166f94b9de" },
    { format: "cmyka", operations: ["-region", "2x2+1+1", "-roll", "+1-1", "+region"], hex: "15365879a7a1641e39603744501f19456a8fb4d2881b39588bdb00254a6f94b9de03282c4f7397b67c2e4f716f13385d82a7ccf1163b60092138509a" },
    { format: "cmyk", operations: ["-roll", "+1-1"], hex: "1f44698e6388add2f71c41668bb0d5fa6f94b9deb3d8fd22476c91b6db00254acff4193e13385d82a7ccf1163b6085aa" },
    { format: "cmyk", operations: ["-region", "2x2+1+1", "+region"], hex: "13385d82a7ccf1163b6085aacff4193e6388add2f71c41668bb0d5fa1f44698eb3d8fd22476c91b6db00254a6f94b9de" },
    { format: "cmyka", operations: ["-roll", "+1-1"], hex: "22476c91b6f71c41668bb0d5fa1f44698eb3d8fd062b50759adb00254a6f94b9de03284d7297bce13e6388add213385d82a7ccf1163b6085aacff419" }
];

for (const mode of ["command", "buffered", "sync", "retained"])
    it.each(cases)(`${mode}: $format $operations`, async ({ format, operations, hex }) => {
        const input = Uint8Array.from({ length: format === "cmyka" ? 60 : 48 }, (_, i) => (37 * i + 19) % 256);
        const files = new Map([["/in.raw", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        const argv = ["-size", "4x3", "-depth", "8", `${format}:/in.raw`, ...operations, "-depth", "8", `${format}:/out`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
