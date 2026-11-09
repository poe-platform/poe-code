import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35: -channel <selection> -function Polynomial 0.8.
// Negation removes channels from the mask accumulated so far.
for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each([
    ["All", "rgba"],
    ["All,!Alpha", "rgb"],
    ["All,!Red", "gba"],
    ["!Red", ""],
    ["!Alpha", ""],
    ["!Red,All", "rgba"],
    ["All,!Red,Red", "rgba"],
    ["All,!Red,!Blue", "ga"],
    ["All,!All", ""],
    ["All,!Default", ""],
    ["All,!A", "rgb"],
    ["All,!Cyan", "gba"],
    ["All, !Red", "gba"],
    ["All,!Green,Blue", "rba"],
    ["Red,!R", ""],
    ["All,!Sync", "rgba"],
    ["All,!0", "gba"],
    ["All,!1", "rba"],
    ["All,!4", "rgb"],
    ["All,!ReadMask", "rgba"],
    ["All|!Alpha", "rgb"],
  ] as const)(`${mode}: honors channel exclusions in %s`, async (selection, selected) => {
    const pixels = [11, 22, 33, 88, 55, 66, 77, 99];
    const input = await sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-channel", selection, "-function", "Polynomial", "0.8", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect([...decodeImage(output).data]).toEqual(pixels.map((value, index) => selected.includes("rgba"[index % 4]!) ? 204 : value));
  });
  it.each(["All,!RGB", "All,!RGBA", "All,!RG", "All,!!Red", "All,!Unknown"])(`${mode}: rejects invalid exclusion %s without replacing output`, async selection => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["/out.png", original]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/out.png", original);
    const args = ["-size", "1x1", "xc:red", "-channel", selection, "-function", "Polynomial", "0.8", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unrecognized channel type");
    expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
  });
}
