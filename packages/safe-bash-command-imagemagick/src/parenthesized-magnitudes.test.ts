import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from({ length: 48 }, (_, i) => {
    const pixel = Math.floor(i / 4);
    return i % 4 === 3 ? 255 : ([31, 73, 47][i % 4]! * pixel + [20, 80, 13][i % 4]!) % 256;
});

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output for the literal magnitude 2.
const cases = [
    { option: "-swirl", length: 48, hash: "90ed9de51bb75b044be40e52a312a671759e58acfdd18ff7ada10f1d2a7d6741" },
    { option: "-implode", length: 48, hash: "f288c74af1aa96d364dec9ec86ce55ad4b0b4761cbe17aee95f841ce91dd6ff7" },
    { option: "-wave", length: 112, hash: "844a31bcf96342ae77b4cb018ddf1b214329d7dcd8651288833d6ecb47929ddc" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const magnitude of ["2", "(2)"]) {
        it.each(cases)(`${mode}: $option ${magnitude} matches native pixels`, async ({ option, length, hash }) => {
            const files = new Map([["/in.raw", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["-size", "4x3", "-depth", "8", "rgba:/in.raw", option, magnitude, "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result, stderr).toMatchObject({ exitCode: 0 });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(output.length).toBe(length);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        });
    }
}
