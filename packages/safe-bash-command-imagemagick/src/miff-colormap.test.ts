import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Four-bit PNG with duplicate reds and unused entries, in the original file order.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADBAMAAABG2rP1AAAAMFBMVEX/AAAA/wAAAP//AABkMhQAZJb///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC7dSOKAAAAEUlEQVR4nGNwZGUwD2dQdgQABSoBOc0JSuMAAAAASUVORK5CYII=", "base64");
const indices = [4, 1, 0, 5, 3, 7, 5, 7, 2, 3, 4, 1];
const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it(`preserves the indexed PNG colormap and indices in saved MIFF (${mode})`, async () => {
        const files = new Map<string, Uint8Array>([["/pal.png", png]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/pal.png", png);
        const args = ["/pal.png", "/out.miff"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = Buffer.from(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!);
        const offset = output.indexOf(Buffer.from([58, 26])) + 2;
        expect(output.subarray(0, offset).toString()).toContain("class=PseudoClass colors=16");
        expect(output.subarray(offset, offset + 48)).toEqual(png.subarray(41, 89));
        expect([...output.subarray(offset + 48)]).toEqual(indices);
        if (nativeMagick) {
            const expected = spawnSync("magick", ["png:-", "miff:-"], { input: png });
            expect(expected.status, expected.stderr.toString()).toBe(0);
            for (const input of [expected.stdout, output]) {
                const identified = spawnSync("magick", ["miff:-", "-format", "%r", "info:"], { input });
                expect(identified.status, identified.stderr.toString()).toBe(0);
                expect(identified.stdout.toString()).toBe("PseudoClass sRGB ");
                const cycled = spawnSync("magick", ["miff:-", "-cycle", "1", "-depth", "8", "rgba:-"], { input });
                expect(cycled.status, cycled.stderr.toString()).toBe(0);
                expect(cycled.stdout.toString("hex")).toBe("006496ff0000ffff00ff00ffffffffff643214ff000000ffffffffff000000ffff0000ff643214ff006496ff0000ffff");
            }
        }
    });
}
