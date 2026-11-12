import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI metadata and complete RGB8 stream hashes.
const cases = [
    { name: "palette input", operations: [], metadata: "PseudoClass sRGB |3x3", hash: "d006a437bdb156512f25856b6114094597642b5b9ced5ac520ab49ac21d3534a" },
    { name: "zero shear", operations: ["-shear", "0"], metadata: "PseudoClass sRGB |3x3", hash: "d006a437bdb156512f25856b6114094597642b5b9ced5ac520ab49ac21d3534a" },
    { name: "nonzero shear", operations: ["-shear", "20x0"], metadata: "DirectClass sRGB |4x3", hash: "37736abe33e1358dbc40230af2bd52bcd2442e24cc5a1fc4a6966cf82a800120" },
    { name: "cycle after nonzero shear", operations: ["-shear", "20x0", "-cycle", "1"], metadata: "PseudoClass sRGB |4x3", hash: "ef9c138a318ad57975a2d30d03cd091a16c7fafc0d9e2ae6e0840bf1ea8999ef" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: matches native palette class and pixels for $name`, async ({ operations, metadata, hash }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x3", "gradient:#103050-#d0b090", "-type", "Palette", ...operations,
            "-format", "%r|%wx%h", "-write", "info:/class", "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const rgb = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(hash);
        const info = mode === "command" || mode === "retained" ? await filesystem.readFile("/class") : files.get("/class")!;
        expect(new TextDecoder().decode(info)).toBe(metadata);
    });
}
