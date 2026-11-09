import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command", "mogrify"] as const) {
    for (const depth of [8, 16]) {
        it(`preserves RGBA${depth} pixels for an explicit empty channel-fx expression in ${mode}`, async () => {
            // Native ImageMagick 7.1.2-35 preserves the input with -channel-fx '' +append.
            const input = Buffer.from(depth === 8
                ? "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MjI6NTUrMDA6MDCZ5uVXAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjIyOjU1KzAwOjAw6Ltd6wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoyMjo1NSswMDowML+ufDQAAAARSURBVAjXYxAyCatYffb9OwAOQARqQ6nkkgAAAABJRU5ErkJggg=="
                : "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAGUlEQVQI12MQMnFNr5jVwLj67HvGsIoDzAAzWgZ/WP2H5AAAAABJRU5ErkJggg==", "base64");
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const options = ["-channel-fx", "", "+append", "-depth", String(depth)];
            const argv = ["/input.png", ...options, `PNG${depth === 8 ? 32 : 64}:/out.png`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "mogrify" ? await filesystem.readFile("/input.png")
                : mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([2, 1]);
            expect([...(depth === 16 ? output.data16! : output.data)]).toEqual(depth === 16
                ? [0x1234, 0x4567, 0x789a, 0x8001, 0xabcd, 0xef01, 0x5678, 0xc003]
                : [...Buffer.from("12345678abcdefee", "hex")]);
        });
    }
}
