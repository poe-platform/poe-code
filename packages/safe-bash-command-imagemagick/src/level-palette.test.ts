import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
    { name: "used", png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAABlBMVEUgQGDIoIwUq6epAAAACklEQVR4nGNwAAAAQgBBKTf07wAAAABJRU5ErkJggg==" },
    { name: "unused", png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEUgQGDIoIwUq6epAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==" },
];
// Native ImageMagick 7.1.2-35 Q16-HDRI, including the unused second palette entry.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) {
        for (const cycle of [false, true]) {
            it.each([
                { operations: [], colors: ["204060ff", "c8a08cff"] },
                { operations: ["-level", "20%,80%"], colors: ["00164bff", "f8b694ff"] },
                { operations: ["+level", "20%,80%"], colors: ["46596dff", "ab9387ff"] },
                { operations: ["-level-colors", "navy,wheat"], colors: ["214a00ff", "d0b83cff"] },
                { operations: ["+level-colors", "navy,wheat"], colors: ["1f3893ff", "c08b9cff"] },
            ])(`${mode} ${fixture.name} cycle=${cycle}: $operations`, async ({ operations, colors }) => {
                const input = Buffer.from(fixture.png, "base64");
                const files = new Map<string, Uint8Array>([["/in.png", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.png", input);
                const args = ["/in.png", ...operations, ...(cycle ? ["-cycle", "1"] : []), "-depth", "8", "rgba:/out"];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write() {} },
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result.exitCode).toBe(0);
                const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
                const ordered = cycle ? [...colors].reverse() : colors;
                expect(Buffer.from(output).toString("hex")).toBe(ordered.slice(0, fixture.name === "used" ? 2 : 1).join(""));
                expect(input.toString("base64")).toBe(fixture.png);
            });
        }
    }
}

const alphaPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAABHRSTlMowP+AOSYJWQAAAA1JREFUeJxjYGBkYgYAAA8AB4SOmW0AAAAASUVORK5CYII=", "base64");
for (const retained of [false, true]) {
    it.each([
        { operations: ["-level", "20%,80%"], expected: "02ff35eb0035ffffffff0080ff000000" },
        { operations: ["+level", "20%,80%"], expected: "52ad65a64665bfcccaae4680c339474b" },
        { operations: ["-level-colors", "navy,wheat"], expected: "36ea0000215fff00ffeb0000fa0b0000" },
        { operations: ["+level-colors", "navy,wheat"], expected: "32b291ff1f48affff1b286ffe70987ff" },
    ])(`adjusts palette alpha before cycling (retained=${retained}): $operations`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>([["/in.png", alphaPng]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", alphaPng);
        const result = await runConvertCli(["/in.png", ...operations, "-cycle", "1", "-depth", "8", "rgba:/out"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = retained ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
