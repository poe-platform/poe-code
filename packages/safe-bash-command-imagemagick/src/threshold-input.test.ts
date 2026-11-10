import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64"));
// Decoded RGBA hashes from ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1.
const thresholds = [
    { option: "-random-threshold", value: "0x100%", hash: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { option: "-range-threshold", value: "10,30,60,90%", hash: "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7" },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const placement of ["before input", "after delete", "after input"] as const) {
        it.each(thresholds)(`handles $option ${placement} (${mode})`, async ({ option, value, hash }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.png", input], ["/out.png", original]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const operation = ["-seed", "17", option, value];
            const argv = placement === "after input" ? ["/in.png", ...operation, "PNG32:/out.png"]
                : [...(placement === "after delete" ? ["/in.png", "+delete"] : []), ...operation, "/in.png", "PNG32:/out.png"];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
            expect.soft(result.stdout).toBe("");
            if (placement === "after input") {
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([8, 6]);
                expect(createHash("sha256").update(image.data).digest("hex")).toBe(hash);
            } else {
                expect.soft(result.exitCode).toBe(1);
                expect.soft(result.stderr).toContain(`no images found for operation '${option}'`);
                expect.soft(output).toEqual(original);
            }
        });
    }
}
