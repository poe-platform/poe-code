import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Complete 5x3 RGBA8 canvases from ImageMagick 7.1.2-35 Q16-HDRI.
const stamp = ["xc:#ff000080", "xc:blue", "+append", "-write", "stamp.miff", "+delete"];
for (const mode of ["command", "map", "filesystem"] as const) {
    it.each([
        { setup: [], draw: "image Copy 1,1 0,0 'in.ppm'", hash: "d92070110e9ef91f1fd88ddd59189287723caef37453819e677734c86a3fd2b7" },
        { setup: stamp, draw: "image Over 1,1 0,0 'stamp.miff'", hash: "1a6401262732a1e4c0d6761a65fa47a1c06f57a179df0a522a2efc4113d97df5" },
        { setup: stamp, draw: "image Over 1,1 2,1 'stamp.miff'", hash: "1a6401262732a1e4c0d6761a65fa47a1c06f57a179df0a522a2efc4113d97df5" },
        { setup: stamp, draw: "image Over 1,1 4,2 'stamp.miff'", hash: "3ae0eae233ff6cd0372a5f09219d4a95ec083fee1c9d64fb40c23c7c98300844" },
        { setup: stamp, draw: "image Copy 1,1 2,1 'stamp.miff'", hash: "2b390599a3920d0a4e2979d7083b9042b86fe94456baed7a3295133161fc83f1" },
        { setup: stamp, draw: "image Multiply 1,1 2,1 'stamp.miff'", hash: "aa3b37d84a2f984a0281f2f113e6383082e508a71174ca9038e8abaae1ec745c" },
        { setup: [], draw: "translate 1,1 image Copy 0,0 0,0 'in.ppm'", hash: "d92070110e9ef91f1fd88ddd59189287723caef37453819e677734c86a3fd2b7" },
        { setup: [], draw: "fill lime path 'M 0,0 L 4,0 L 4,2 L 0,2 Z' image Copy 1,1 0,0 'in.ppm'", hash: "d92070110e9ef91f1fd88ddd59189287723caef37453819e677734c86a3fd2b7" },
        { setup: stamp, draw: "translate 1,1 image Over 0,0 0,0 'stamp.miff'", hash: "1a6401262732a1e4c0d6761a65fa47a1c06f57a179df0a522a2efc4113d97df5" },
        { setup: stamp, draw: undefined, hash: "2cc0cfd7155c320b5b698b0455834533f5eeb7b1bfa980c964bb7700cecd505f" },
    ])(`${mode}: renders $draw`, async ({ setup, draw, hash }) => {
        const ppm = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
        const args = [...setup, "-size", "5x3", "xc:lime", ...(draw ? ["-draw", draw] : ["stamp.miff", "-geometry", "+1+1", "-compose", "Over", "-composite"]), "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        await fs.mkdir("/drawing", { recursive: true });
        await fs.writeFile("/drawing/in.ppm", ppm);
        const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args,
            cwd: "/drawing", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async bytes => { stdout.push(bytes); } },
            stderr: { write: async bytes => { stderr.push(bytes); } },
        }) : await runConvertCli(args, mode === "map" ? new Map([["in.ppm", ppm]]) : { filesystem: fs, cwd: "/drawing" });
        expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(bytes.length).toBe(60);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}

for (const mode of ["map", "filesystem"] as const) {
    it(`${mode}: resolves quoted local sources inside MVG input`, async () => {
        const files = new Map([
            ["local stamp.ppm", Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])])],
            ["drawing.mvg", Buffer.from("viewbox 0 0 5 3 image Copy 1,1 0,0 'local stamp.ppm'")],
        ]);
        const filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/drawing", { recursive: true });
        for (const [name, bytes] of files) await filesystem.writeFile(`/drawing/${name}`, bytes);
        const result = await runConvertCli(["-background", "lime", "mvg:drawing.mvg", "-depth", "8", "rgba:-"], mode === "map" ? files : { filesystem, cwd: "/drawing" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(createHash("sha256").update(result.stdoutBytes!).digest("hex")).toBe("d92070110e9ef91f1fd88ddd59189287723caef37453819e677734c86a3fd2b7");
    });

    it.each([
        "image Copy 1,1 0,0 'missing.ppm'",
        "image Copy 1,1 0,0 'broken.ppm'",
        "image Invalid 1,1 0,0 'broken.ppm'",
        "image Copy NaN,1 0,0 'broken.ppm'",
        "image Copy 1,1 1e12,1e12 'broken.ppm'",
        "image Copy 1,1 -1,1 'broken.ppm'",
        "image Copy 1,1 0,0",
    ])(`${mode}: preserves output when drawing fails: %s`, async draw => {
        const original = new TextEncoder().encode("keep");
        const files = new Map([["out.png", original], ["broken.ppm", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const result = await runConvertCli(["-size", "5x3", "xc:lime", "-draw", draw, "out.png"], mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stdoutBytes?.length ?? 0).toBe(0);
        expect(mode === "map" ? files.get("out.png") : await filesystem.readFile("/out.png")).toEqual(original);
    });
}
