import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "./smush-fixtures.json" with { type: "json" };

for (const mode of ["public", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        const fixture = fixtures.find(value => value.name === `${operation} 2`)!;
        it.each([
            { gap: "%[fx:1+1]", settings: [] },
            { gap: "%w", settings: [] },
            { gap: "%h", settings: [] },
            { gap: "%[fx:w]", settings: [] },
            { gap: "%[fx:mean.r*2]", settings: [] },
            { gap: "%[mygap]", settings: ["-set", "option:mygap", "2"] },
            { gap: "%[option:mygap]", settings: ["-set", "option:mygap", "2"] },
            { gap: "%[mygap]", settings: ["-set", "mygap", "2"] },
        ])(`${mode} ${operation} expands $gap against the first image`, async ({ gap, settings }) => {
            const argumentValues = createCommandArguments([
                ...fixture.args.slice(0, -2), ...settings, operation, gap,
                "-set", "option:mygap", "9", "out.png",
            ]);
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let stderr = "";
            const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files)
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                });
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const image = decodeImage(mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png"));
            expect([image.width, image.height]).toEqual([fixture.width, fixture.height]);
            expect([...image.data]).toEqual(fixture.pixels);
        });

        it.each(["2bad", "", "9007199254740992"])(`${mode} ${operation} preserves the destination for invalid expanded gap %s`, async gap => {
            const original = new TextEncoder().encode("keep existing output");
            const fs = new MemoryFileSystem(), files = new Map([["out.png", original]]);
            await fs.writeFile("/out.png", original);
            const argumentValues = createCommandArguments([
                ...fixture.args.slice(0, -2), "-set", "option:mygap", gap, operation, "%[mygap]", "out.png",
            ]);
            let stderr = "";
            const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files)
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                });
            expect(result.exitCode).not.toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toContain("Invalid smush geometry");
            expect(mode === "sync" ? files.get("out.png") : await fs.readFile("/out.png")).toEqual(original);
        });
    }
}
