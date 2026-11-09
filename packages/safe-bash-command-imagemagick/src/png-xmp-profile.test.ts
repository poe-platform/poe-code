import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runIdentifyCli } from "./index.js";

// Native PNG with a synthetic 223-byte XMP profile, comment and unequal density axes.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAJcEhZcwAAEnQAAA3XAUw2FB8AAAD0elRYdFJhdyBwcm9maWxlIHR5cGUgeG1wAAAYlW1RSY7EIAy8+xXzBFIGG56DAtxa6uM8f8qkNa1eQIIEl2sB+b3d5ScGoKKnV+1ebXiyYcWzHUjxb6dN16jpAOywbMtgRft1/o9e5JlBBEJMe0HO2d5IrloQVc+cSTsbl++B6QRh2nKIOZYe2mLyKym4guu4SLirN9JS2ytGCERZ59MC9Yu4mvKgeSK00fx89USofnGUvLDrvNyEGQkglhU2lkgd2tSkS0zd+ZE2WVCWT9kQCc+yTdd9bY2UgwEKW5pnhmIcqkVYBsF6vc3H2eOp5PlWOlOXPzRYbaddssCMAAAAFXRFWHRjb21tZW50AG9yZGluYXJ5IG5vdGXx06zWAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIyOjQ1OjE4KzAwOjAwGZb4wAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMjo0NToxOCswMDowMGjLQHwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjI6NDU6MTgrMDA6MDA/3mGjAAAA+ElEQVRo3u3UsRGDMAyF4eMuKbkUFJSMwAoa/W3ECimCiWxZQJ38BY3yImNhf8NzeQ3zOo3/+jwk2bxO47y5Ry7k6ir1TWdZK3WFvgo98+yxlrW1PBvXarLWZj8DOBrrRuM96ze76U62GVh3LetnS03hvZRm/YbVzx4D6PyguJhlL1Y3ToYYs5ZuLNtc6PtdS+7kpSd6X0uuVg/AfYl49HXRuLkm9VWx6+z5VVH9f4sDU5Y9vdYYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAE/asAbcf6gyQcdYMsAAAAASUVORK5CYII=", "base64");
const profile = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:description="synthetic-audit-tag"/></rdf:RDF></x:xmpmeta>\n');

for (const mode of ["buffered", "retained", "command"] as const) {
  for (const options of [[], ["-sample", "16x12"], ["-thumbnail", "16x12"], ["-thumbnail", "64x48"], ["-strip"], ["+profile", "xmp"], ["+profile", "*"], ["+profile", "exif"]]) {
    it(`preserves or removes PNG XMP: ${mode} ${options.join(" ") || "round trip"}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/grid.png", input);
      const files = new Map([["/grid.png", new Uint8Array(input)]]);
      const args = ["grid.png", ...options, "PNG32:out.png"];
      if (mode === "command") {
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(result, stderr).toMatchObject({ exitCode: 0 });
      } else {
        expect(await runConvertCli(["/grid.png", ...options, "PNG32:/out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" }))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
      const native = spawnSync("magick", ["-", ...options, "PNG32:-"], { input });
      expect(native.status, native.stderr.toString()).toBe(0);
      const removed = options.includes("-thumbnail") || options.includes("-strip") || options.includes("xmp") || options.includes("*");
      const identify = (bytes: Uint8Array) => spawnSync("magick", ["identify", "-quiet", "-format", "%[profiles]|%x|%y|%[comment]", "-"], { input: bytes, encoding: "utf8" });
      const actual = identify(output), expected = identify(native.stdout);
      expect(actual.status, actual.stderr).toBe(0);
      expect(actual.stdout).toBe(expected.stdout);
      expect(actual.stdout.split("|")[0]).toBe(removed ? "" : "xmp");
      if (!removed) {
        const extracted = spawnSync("magick", ["-", "xmp:-"], { input: output });
        expect(extracted.status, extracted.stderr.toString()).toBe(0);
        expect(extracted.stdout).toEqual(profile);
      }
      if (!options.includes("-thumbnail")) {
        const pixels = (bytes: Uint8Array) => spawnSync("magick", ["-", "-depth", "8", "rgba:-"], { input: bytes }).stdout;
        expect(pixels(output)).toEqual(pixels(native.stdout));
      }
      const identified = await runIdentifyCli(["-format", "%[profiles]", "/out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(identified).toEqual({ exitCode: 0, stdout: removed ? "" : "xmp", stderr: "" });
    });
  }
}
