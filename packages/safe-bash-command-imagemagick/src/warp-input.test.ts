import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI, decoded 8-bit RGBA hashes.
const operations = [
    { args: ["-swirl", "105"], height: 7, hash: "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b" },
    { args: ["-implode", "1.25"], height: 7 },
    { args: ["-wave", "2x8"], height: 11, hash: "2b460165d6bea062e0486b82c1d0a3f0c06cdf3280f41b5eb906baa1df30cf40" },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const placement of ["before input", "after delete", "empty substack", "after input"] as const) {
        it.each(operations)(`handles $args ${placement} (${mode})`, async ({ args: operation, height, hash }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["in.png", input], ["out.png", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
            const args = placement === "after input" ? ["in.png", ...operation, "PNG32:out.png"]
                : placement === "empty substack" ? ["in.png", "(", ...operation, "in.png", ")", "PNG32:out.png"]
                : [...(placement === "after delete" ? ["in.png", "+delete"] : []), ...operation, "in.png", "PNG32:out.png"];
            let stdout = "", stderr = "";
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png");
            expect.soft(result.stdout).toBe("");
            if (placement === "after input") {
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([9, height]);
                expect(image.data).not.toEqual(decodeImage(input).data);
                if (hash) expect(createHash("sha256").update(image.data).digest("hex")).toBe(hash);
            } else {
                expect.soft(result.exitCode).toBe(1);
                expect.soft(result.stderr).toContain(`no images found for operation '${operation[0]}'`);
                expect.soft(output).toEqual(original);
            }
        });
    }
}
