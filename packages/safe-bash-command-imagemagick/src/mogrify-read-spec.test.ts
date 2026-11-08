import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const)
for (const spec of ["pair.gif[1]", "GIF:pair.gif[1]", "PNG:a.png"]) {
    it(`reads mogrify image specifications ${spec} (${mode})`, async () => {
        const a = await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const b = await sharp(new Uint8Array([0, 0, 255, 255, 255, 255]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["a.png", a], ["b.png", b]]);
        expect(runMagickCliSync(["a.png", "b.png", "pair.gif"], files).exitCode).toBe(0);
        const filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/dest");
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const gif = spec.includes("gif"), name = gif ? "pair.gif" : "a.png", original = files.get(name)!;
        const symlink = mode === "retained-symlink", target = symlink ? `link.${gif ? "gif" : "png"}` : name;
        if (symlink) await filesystem.symlink(name, `/${target}`);
        const argv = ["mogrify", "-path", "dest", "-negate", spec.replace(name, target)];
        const retained = mode.startsWith("retained");
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(retained ? await filesystem.readFile(`/${name}`) : files.get(name)).toEqual(original);
        const names = retained ? (await filesystem.readdir("/dest")).map(entry => entry.name) : [...files.keys()].filter(path => path.startsWith("dest/")).map(path => path.slice(5));
        expect(names).toEqual([target]);
        const output = retained ? await filesystem.readFile(`/dest/${target}`) : files.get(`dest/${target}`)!;
        expect(Array.from(decodeImage(output).data)).toEqual(gif ? [255, 255, 0, 255, 0, 0, 0, 255] : [0, 255, 255, 255, 255, 0, 255, 255]);
        if (symlink) expect((await filesystem.lstat(`/${target}`)).type).toBe("symlink");
    });
}
