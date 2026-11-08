import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: four 4x3 red/lime/blue/yellow frames, delays 7/11/17/23.
const fixture = Uint8Array.from(Buffer.from("R0lGODlhBAADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABwAAACwAAAAABAADAAACA4SPVgAh+QQACwAAACwAAAAABAADAIAA/wAAAAACA4SPVgAh+QQAEQAAACwAAAAABAADAIAAAP8AAAACA4SPVgAh+QQAFwAAACwAAAAABAADAID//wAAAAACA4SPVgA7", "base64"));

const literal = encodeImage({ width: 2, height: 2, data: Uint8Array.from(Array(4).fill([255, 0, 255, 255]).flat()),
    format: "gif", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "gif" }).data;

for (const mode of ["buffered", "retained", "command", "sync"] as const) {
    for (const spec of ["bogus", "2"]) {
        for (const present of [true, false]) {
            it(`${mode}: [${spec}] with literal file ${present ? "present" : "missing"}`, async () => {
                const path = `in.gif[${spec}]`;
                const files = new Map<string, Uint8Array>([["in.gif", fixture], ["out.gif", fixture]]);
                if (present) files.set(path, literal);
                const filesystem = new MemoryFileSystem();
                for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
                const args = [path, "out.gif"];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                const actual = mode === "buffered" || mode === "sync" ? files.get("out.gif")! : await filesystem.readFile("/out.gif");
                if (spec === "bogus" && !present) {
                    expect(result.exitCode).toBe(1);
                    expect(actual).toEqual(fixture);
                } else {
                    expect(result.exitCode).toBe(0);
                    const decoded = decodeImage(actual, { animated: true });
                    const expected = decodeImage(spec === "2" ? fixture : literal, { page: spec === "2" ? 2 : 0 });
                    expect(decoded.pages ?? 1).toBe(1);
                    expect([decoded.width, decoded.height]).toEqual([expected.width, expected.height]);
                    expect(decoded.data).toEqual(expected.data);
                }
            });
        }
    }
}
