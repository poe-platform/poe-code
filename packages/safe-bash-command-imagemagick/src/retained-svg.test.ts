import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { runIdentifyCli, runCompareCli } from "./index.js";
const bytes = new TextEncoder().encode('<svg width="37" height="29" viewBox="-2 -3 37 29"><rect width="30" height="25" fill="blue" opacity="0.4" rx="3"/><g transform="translate(3 1) rotate(12 10 10)"><circle cx="12" cy="12" r="8" fill="red" stroke="green" stroke-width="2"/><path d="M2 20l5 -4h4v8C15 20 20 12 22 20Q28 28 32 19z" fill="yellow" opacity="0.6" stroke="black"/></g><text x="24" y="25" font-size="10" text-anchor="middle">A&amp;g</text></svg>');
function retained(fs: MemoryFileSystem) {
    return new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
}
it.each([[], ["-verbose"], ["-format", "%m %wx%h %[mean] %[standard-deviation] %[fx:p{12,12}.r] %[pixel:p{3,3}]"]].map(options => ({ options })))("identifies retained SVG with $options", async ({ options }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a.svg", bytes);
    expect(await runIdentifyCli([...options, "a.svg"], { filesystem: retained(fs), cwd: "/" })).toEqual(await runIdentifyCli([...options, "a.svg"], new Map([["a.svg", bytes]])));
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a.svg"]);
});
it("compares SVG retained transforms with buffered pixel parity", async () => {
    const fs = new MemoryFileSystem(), files = new Map([["a.svg", bytes]]);
    await fs.writeFile("/a.svg", bytes);
    const args = ["-metric", "RMSE", "a.svg[23x17!]", "a.svg[23x17+2+1]", "out.png"];
    expect(await runCompareCli(args, { filesystem: retained(fs), cwd: "/" })).toEqual(await runCompareCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a.svg", "out.png"]);
});
