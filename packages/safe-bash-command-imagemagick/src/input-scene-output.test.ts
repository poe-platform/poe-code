import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

const fixture = spawnSync("magick", ["-size", "2x1", "-delay", "4", "xc:red", "-delay", "8", "xc:lime", "-delay", "12", "xc:blue", "gif:-"]);
if (fixture.status !== 0) throw new Error(fixture.stderr.toString());
const seed = spawnSync("magick", ["-size", "1x1", "xc:magenta", "png:-"]);
if (seed.status !== 0) throw new Error(seed.stderr.toString());

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const write of [false, true])
for (const spec of ["", "2", "2,0"])
for (const scene of [undefined, 0, 7])
for (const pattern of ["frame%02d.png", "frame.png"])
it(`numbers selected input scenes: ${mode}, write=${write}, [${spec}], scene=${scene}, ${pattern}`, async () => {
    const files = new Map<string, Uint8Array>([["in.gif", new Uint8Array(fixture.stdout)], ["frame00.png", new Uint8Array(seed.stdout)]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = [spec ? `in.gif[${spec}]` : "in.gif", ...(scene === undefined ? [] : ["-scene", String(scene)]), ...(write ? ["-write", pattern, "null:"] : [pattern])];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stderr" in result) stderr = String(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    const frames = spec === "2" ? [2] : spec === "2,0" ? [2, 0] : [0, 1, 2];
    const start = scene ?? frames[0]!;
    const names = frames.map((_, index) => pattern === "frame%02d.png" ? `frame${String(start + index).padStart(2, "0")}.png` : frames.length === 1 ? "frame.png" : `frame-${start + index}.png`);
    const memory = mode === "sync" || mode === "buffered";
    expect((memory ? [...files.keys()] : (await filesystem.readdir("/")).map(entry => entry.name)).sort()).toEqual([...new Set(["in.gif", "frame00.png", ...names])].sort());
    for (const [index, name] of names.entries()) {
        const image = decodeImage(memory ? files.get(name)! : await filesystem.readFile(`/${name}`));
        expect([image.width, image.height]).toEqual([2, 1]);
        expect([...image.data.slice(0, 4)]).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][frames[index]!]);
    }
    if (!names.includes("frame00.png")) expect(memory ? files.get("frame00.png") : await filesystem.readFile("/frame00.png")).toEqual(new Uint8Array(seed.stdout));
});
