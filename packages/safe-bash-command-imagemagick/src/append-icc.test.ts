import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const tagged = readFileSync(new URL("./fixtures/append-icc-tagged.png", import.meta.url));
const other = readFileSync(new URL("./fixtures/append-icc-other.png", import.meta.url));
// Native ImageMagick 7.1.2-35 Q16-HDRI: magick tagged.png other.png +append out.png.
const reference = decodeImage(readFileSync(new URL("./fixtures/append-icc-out.png", import.meta.url)));
const profile = decodeImage(tagged).icc!;

it("uses the exact embedded ICC bytes preserved by native append", () => {
    expect(createHash("sha256").update(profile).digest("hex")).toBe("85ed2acb39999ffd18a0a7ba695522c36003e7bd190ed18d962cb3500b9b2ad0");
    expect(reference.icc).toEqual(profile);
});

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+append", "-append"]) {
        it.each([
            { name: "tagged first image", inputs: ["tagged.png", "other.png"], options: [], expected: profile },
            { name: "untagged first image", inputs: ["other.png", "tagged.png"], options: [], expected: undefined },
            { name: "single tagged image", inputs: ["tagged.png"], options: [], expected: profile },
            { name: "stripped output", inputs: ["tagged.png", "other.png"], options: ["-strip"], expected: undefined },
            { name: "removed profile", inputs: ["tagged.png", "other.png"], options: ["+profile", "icc"], expected: undefined },
        ])(`${mode}: ${operation} preserves the profile of $name`, async ({ inputs, options, expected }) => {
            const files = new Map<string, Uint8Array>([["tagged.png", tagged], ["other.png", other]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
            const argv = [...inputs, operation, ...options, "out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect(output.icc).toEqual(expected);
            if (operation === "+append" && inputs.length === 2 && inputs[0] === "tagged.png") {
                expect([output.width, output.height]).toEqual([reference.width, reference.height]);
                expect(output.data).toEqual(reference.data);
            }
        });
    }
}
