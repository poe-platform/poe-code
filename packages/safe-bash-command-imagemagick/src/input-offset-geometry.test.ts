import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: four 4x3 red/lime/blue/yellow frames, delays 7/11/17/23.
const fixture = Uint8Array.from(Buffer.from("R0lGODlhBAADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABwAAACwAAAAABAADAAACA4SPVgAh+QQACwAAACwAAAAABAADAIAA/wAAAAACA4SPVgAh+QQAEQAAACwAAAAABAADAIAAAP8AAAACA4SPVgAh+QQAFwAAACwAAAAABAADAID//wAAAAACA4SPVgA7", "base64"));

for (const mode of ["buffered", "retained", "command", "sync"] as const) {
    for (const [spec, width, height] of [
        ["", 4, 3], ["+2+1", 4, 3], ["+2", 4, 3], ["+0+0", 4, 3], ["2x1+1+1", 2, 1]
    ] as const) {
        it(`${mode}: read geometry [${spec}] preserve frame pixels, dimensions, delays`, async () => {
            const files = new Map([["in.gif", fixture], ["out.gif", fixture]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.gif", fixture);
            await filesystem.writeFile("/out.gif", fixture);
            const args = [spec ? `in.gif[${spec}]` : "in.gif", "out.gif"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            const actual = mode === "buffered" || mode === "sync" ? files.get("out.gif")! : await filesystem.readFile("/out.gif");
            expect(result.exitCode).toBe(0);
            const decoded = decodeImage(actual, { animated: true });
            expect(decoded.pages ?? 1).toBe(4);
            for (const page of [0, 1, 2, 3]) {
                const frame = decodeImage(actual, { page, coalesce: false });
                const original = decodeImage(fixture, { page });
                expect([frame.width, frame.height]).toEqual([width, height]);
                expect(frame.data).toEqual(Uint8Array.from(Array(width * height).fill([...original.data.slice(0, 4)]).flat()));
            }
            expect(decoded.delay).toEqual([70, 110, 170, 230]);
        });
    }
}
