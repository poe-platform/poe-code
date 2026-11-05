import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

const native = spawnSync("magick", ["-version"]);
for (const options of [["-bogus"], ["-channel", "bogus"], ["-alpha", "bogus"]]) {
    it(`rejects ${options.join(" ")} before producing a metric or output`, async () => {
        const images = await Promise.all(["red", "blue"].map(background =>
            sharp({ create: { width: 1, height: 1, channels: 4, background } }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = [...options, "a.png", "b.png", "diff.png"];
        for (const result of [
            await runCompareCli(args, files),
            await runCompareCli(args, { filesystem, cwd: "/" }),
            runCompareCliSync(args, files),
            await runMagickCli(["compare", ...args], files)
        ]) {
            expect(result.exitCode).toBe(2);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain(`option '${options[0]}'`);
        }
        expect(files.has("diff.png")).toBe(false);
        await expect(filesystem.readFile("/diff.png")).rejects.toThrow();
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", ...options,
                ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
            expect(reference.status).toBe(2);
            expect(reference.stderr).toContain("bogus");
        }
    });
}

it("rejects unsupported options before reading input images", async () => {
    for (const options of [["-channel", "RGB"], ["-alpha", "off"], ["-format", "%[distortion]"], ["-channel"], ["-alpha"]]) {
        expect(await runCompareCli([...options, "missing.png", "missing.png", "null:"], new Map()))
            .toMatchObject({ exitCode: 2, stderr: `compare: unrecognized option '${options[0]}'\n` });
    }
});
