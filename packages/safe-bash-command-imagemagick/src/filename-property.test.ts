import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`expands filename properties at each output in ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "-set", "filename:foo", "hello",
            "-write", "%[filename:foo].png", "-set", "filename:foo", "tag",
            "+write", "PNG:%[filename:foo]-copy.png", "%[filename:foo].png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const names = mode === "retained" ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
        expect(names.sort()).toEqual(["hello.png", "tag-copy.png", "tag.png"]);
        for (const name of names) {
            const bytes = mode === "retained" ? await filesystem.readFile(`/${name}`) : files.get(name)!;
            expect([...decodeImage(bytes).data]).toEqual([255, 0, 0, 255]);
        }
    });
}
