import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, one thread and seed 42; complete RGB rasters.
const input = Buffer.concat([
    Buffer.from("P6\n5 3\n255\n"),
    Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())
]);
const cases = [
    { radius: "1:", hex: "0000c81336c0aa77824152ada18d86a15a8691178c5489a6c49c77ab9e8290a68daad6826e3b9be3956b868d91" },
    { radius: "1:1", hex: "0000c81336c0aa77824152ada18d86a15a8691178c5489a6c49c77ab9e8290a68daad6826e3b9be3956b868d91" },
    { radius: "2:", hex: "0000c8153abfec8e674a2ba9df6d6cbc067bae158040b2ade0956cb6997d7f8594aad6822f7cb5dc976e418aad" },
    { radius: "2:1", hex: "0000c8153abfec8e674a2ba9df6d6cbc067bae158040b2ade0956cb6997d7f8594aad6822f7cb5dc976e418aad" }
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(cases)(`${mode}: matches native spread radius $radius`, async ({ radius, hex }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const files = new Map([["/in.ppm", input]]);
        const args = ["-limit", "thread", "1", "-seed", "42", "/in.ppm", "-spread", radius, "-depth", "8", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
