import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference metrics.
for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    for (const [operands, metric] of [
        [["-alpha", "off", "a.png", "b.png"], "0 (0)"],
        [["-alpha", "off", "a.png", "c.png"], "0.104575 (0.104575)"],
        [["a.png", "b.png"], "0.322338 (0.322338)"],
        [["a.png", "a.png"], "0 (0)"],
        [["a.png", "-alpha", "off", "b.png"], "0 (0)"],
        [["a.png", "c.png", "-alpha", "off"], "0.104575 (0.104575)"],
        [["(", "a.png", "-alpha", "off", ")", "(", "c.png", "-alpha", "off", ")"], "0.104575 (0.104575)"]
    ] as const) {
        it(`compares RGB independently of opacity: ${operands.join(" ")} (${mode})`, async () => {
            const files = new Map<string, Uint8Array>();
            for (const [name, red, alpha] of [["a.png", 80, 64], ["b.png", 80, 192], ["c.png", 160, 192]] as const) {
                files.set(name, encodeImage({ width: 1, height: 1, channels: 4, depth: "uchar",
                    format: "png", space: "srgb", density: 72, hasAlpha: true,
                    data: Uint8Array.of(red, 120, 200, alpha)
                }, { format: "png" }).data);
            }
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            const args = ["-metric", "AE", ...operands, "null:"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "compare" ? createCompareCommand() : createMagickCommand();
                const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
                let stdout = "", stderr = "";
                result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr };
            } else result = mode === "sync" ? runCompareCliSync(args, files)
                : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({
                exitCode: metric === "0 (0)" ? 0 : 1, stdout: "", stderr: metric
            });
            for (const [path, bytes] of files) expect(await filesystem.readFile(`/${path}`)).toEqual(bytes);
        });
    }
}

for (const options of [["-alpha"], ["-alpha", "bogus"]]) {
    it(`rejects invalid alpha arguments before reading images: ${options.join(" ")}`, async () => {
        const args = ["missing.png", "missing.png", "diff.png", ...options];
        const keep = Uint8Array.of(1, 2, 3);
        const files = new Map([["diff.png", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/diff.png", keep);
        const stderr = options.length === 1 ? "compare: missing an argument for option '-alpha'\n"
            : "compare: Unsupported alpha mode: bogus\n";
        for (const result of [runCompareCliSync(args, files), await runCompareCli(args, files),
            await runCompareCli(args, { filesystem, cwd: "/" })]) {
            expect(result).toEqual({ exitCode: 2, stdout: "", stderr });
        }
        expect(files.get("diff.png")).toEqual(keep);
        expect(await filesystem.readFile("/diff.png")).toEqual(keep);
    });
}
