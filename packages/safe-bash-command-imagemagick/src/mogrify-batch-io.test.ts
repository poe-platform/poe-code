import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { FsError } from "safe-bash-contracts/errors";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMogrifyCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const cases = [
    { name: "middle read failure", args: ["a/x.ppm", "missing.ppm", "a/color.v1.ppm"], errors: ["missing.ppm"], outputs: { "x.png": [255, 0, 0], "color.v1.png": [170, 70, 30] } },
    { name: "multiple read failures", args: ["one.ppm", "a/x.ppm", "two.ppm", "a/color.v1.ppm"], errors: ["one.ppm", "two.ppm"], outputs: { "x.png": [255, 0, 0], "color.v1.png": [170, 70, 30] } },
    { name: "write failure", args: ["-path", "absent", "a/x.ppm", "-path", "dest", "a/color.v1.ppm"], errors: ["absent/x.png"], outputs: { "color.v1.png": [170, 70, 30] } },
    { name: "successful overwrite", args: ["a/x.ppm", "b/x.ppm"], errors: [], outputs: { "x.png": [0, 0, 255] } },
    { name: "fatal option", args: ["a/x.ppm", "-unknown", "b/x.ppm"], errors: ["-unknown"], outputs: { "x.png": [255, 0, 0] } },
    { name: "trailing read failure", args: ["a/x.ppm", "one.ppm"], errors: ["one.ppm"], outputs: { "x.png": [255, 0, 0] } }
];

for (const mode of ["sync", "buffered", "retained", "magick", "mogrify"] as const)
for (const scenario of cases) {
    if (scenario.name === "write failure" && (mode === "sync" || mode === "buffered")) continue;
    it(`processes mogrify batch with ${scenario.name} (${mode})`, async () => {
        const fs = new MemoryFileSystem();
        for (const directory of ["a", "b", "dest"]) await fs.mkdir("/" + directory);
        const files = new Map<string, Uint8Array>();
        for (const [name, rgb] of [["a/x.ppm", "255 0 0"], ["b/x.ppm", "0 0 255"], ["a/color.v1.ppm", "170 70 30"]]) {
            const bytes = new TextEncoder().encode(`P3\n1 1\n255\n${rgb}\n`);
            files.set(name!, bytes);
            await fs.writeFile("/" + name, bytes);
        }
        const args = ["-path", "dest", "-format", "png", ...scenario.args];
        let stdout = "", stderr = "";
        let result: { exitCode: number };
        if (mode === "magick" || mode === "mogrify") {
            const command = mode === "magick" ? createMagickCommand() : createMogrifyCommand();
            const arguments_ = createCommandArguments(mode === "magick" ? ["mogrify", ...args] : args);
            result = await command.execute({
                command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } as CommandContext);
        } else {
            const returned = mode === "sync" ? runMagickCliSync(["mogrify", ...args], files)
                : await runMagickCli(["mogrify", ...args], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            result = returned; stdout = returned.stdout; stderr = returned.stderr;
        }
        expect(result.exitCode).toBe(scenario.errors.length ? 1 : 0);
        expect(stdout).toBe("");
        expect(stderr.trim().split("\n").filter(Boolean)).toHaveLength(scenario.errors.length);
        for (const name of scenario.errors) expect(stderr).toContain(name);
        const buffered = mode === "sync" || mode === "buffered";
        const outputs = buffered ? [...files.keys()].filter(name => name.startsWith("dest/")).map(name => name.slice(5))
            : (await fs.readdir("/dest")).map(entry => entry.name);
        expect(outputs.sort()).toEqual(Object.keys(scenario.outputs).sort());
        for (const [name, rgb] of Object.entries(scenario.outputs)) {
            const bytes = buffered ? files.get("dest/" + name)! : await fs.readFile("/dest/" + name);
            expect(Array.from(decodeImage(bytes).data)).toEqual([...rgb!, 255]);
        }
        for (const name of ["a/x.ppm", "b/x.ppm", "a/color.v1.ppm"]) expect(await fs.readFile("/" + name)).toEqual(files.get(name));
    });
}

for (const failure of ["read", "rename"] as const)
it(`continues after a mogrify ${failure} permission error and preserves failed inputs`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
    await fs.writeFile("/a.ppm", bytes);
    await fs.writeFile("/b.ppm", bytes);
    await fs.symlink("a.ppm", "/link.ppm");
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile" && failure === "read") return (path: string) => {
            if (path === "/link.ppm") throw new FsError("EACCES", { syscall: "open", path });
            return target.openReadFile(path);
        };
        if (key === "rename" && failure === "rename") return () => { throw new FsError("EACCES", { syscall: "rename", path: "/link.ppm" }); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await runMogrifyCli(["-negate", "link.ppm", "b.ppm"], { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("link.ppm");
    expect(Array.from(decodeImage(await fs.readFile("/b.ppm")).data)).toEqual([0, 255, 255, 255]);
    expect(await fs.readFile("/a.ppm")).toEqual(bytes);
    expect((await fs.lstat("/link.ppm")).type).toBe("symlink");
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a.ppm", "b.ppm", "link.ppm"]);
});

it("charges failed mogrify writes against the cumulative input budget", async () => {
    const filesystem = new MemoryFileSystem();
    const bytes = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
    await filesystem.writeFile("/a.ppm", bytes);
    await filesystem.writeFile("/b.ppm", bytes);
    await filesystem.mkdir("/dest");
    const failure = new Error("batch input budget");
    await expect(runMogrifyCli(["-path", "absent", "a.ppm", "-path", "dest", "b.ppm"], {
        filesystem, cwd: "/", inputBudget: { check(total) { if (total > bytes.length) throw failure; } }
    })).rejects.toBe(failure);
    expect(await filesystem.readdir("/dest")).toEqual([]);
});

it("does not continue a mogrify batch after cancellation during a file failure", async () => {
    const fs = new MemoryFileSystem(), controller = new AbortController();
    const bytes = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
    await fs.writeFile("/a.ppm", bytes);
    const failure = new Error("cancel batch");
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "stat") return () => { controller.abort(failure); throw new FsError("EIO"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runMogrifyCli(["-negate", "missing.ppm", "a.ppm"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(failure);
    expect(await fs.readFile("/a.ppm")).toEqual(bytes);
});
