import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

const invalid = ["bogus", "NaN", "Infinity", "12bogus", ""];
const valid = ["0", "10", "1e2", "0%", "10%"];

it("rejects invalid compare fuzz and preserves numeric and percent tolerances", async () => {
    const images = await Promise.all(["red", "blue"].map(background =>
        sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()));
    const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files)
        await filesystem.writeFile(`/${name}`, bytes);
    for (const fuzz of [...invalid, ...valid]) {
        const args = ["-fuzz", fuzz, "a.png", "b.png", "null:"];
        const results = [runCompareCliSync(args, files), await runCompareCli(args, files),
            await runCompareCli(args, { filesystem, cwd: "/" })];
        for (const result of results) {
            expect(result.exitCode).toBe(invalid.includes(fuzz) ? 2 : 1);
            if (invalid.includes(fuzz)) {
                expect(result.stdout).toBe("");
                expect(result.stderr).toContain(`invalid argument for option '-fuzz': ${fuzz}`);
            }
        }
    }
});

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("matches native compare fuzz validation and statuses", async () => {
    expect(native.status).toBe(0);
    const images = await Promise.all(["red", "blue"].map(background =>
        sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()));
    const inputs = images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    for (const fuzz of [...invalid, ...valid]) {
        const result = spawnSync("magick", ["compare", "-fuzz", fuzz, ...inputs, "null:"], { encoding: "utf8" });
        expect(result.status).toBe(invalid.includes(fuzz) ? 2 : 1);
        if (invalid.includes(fuzz))
            expect(result.stderr).toContain(`invalid argument for option '-fuzz': ${fuzz}`);
    }
});
