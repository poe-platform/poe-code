import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// Native ImageMagick: heading.png -thumbnail '48x32!' +repage, then -crop 14x10+6+5.
const part = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAA4AAAAKBAMAAAB293L0AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAtUExURQ8RFhARFhQVFxgYFxUSFhcYFxcXFxkYFxUVFRgXGBkYGRgYGBYWFhMVFBUWFbHKvxwAAAAQY2FOdgAAADAAAAAgAAAABgAAAAUplEkPAAAAJUlEQVQI12NgVHZxTUtLYyg3Cw0D0WkQgEG34aOngemVq8++BgAWwRz+aZxXzgAAAABJRU5ErkJggg==", "base64");

it.each([false, true])("coalesces a single offset PNG onto its full canvas (retained=%s)", async retained => {
    expect(decodeImage(part)).toMatchObject({
        width: 14, height: 10, virtualCanvas: { width: 48, height: 32, x: 6, y: 5 }
    });
    const files = new Map([["part.png", new Uint8Array(part)]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/part.png", part);
    const context = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli(["part.png", "-coalesce", "out.png"], context)).toMatchObject({ exitCode: 0 });
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect(output).toMatchObject({ width: 48, height: 32, virtualCanvas: { width: 48, height: 32, x: 0, y: 0 } });
    expect(output.data).toHaveLength(6144);
    // SHA-256 of native ImageMagick's out.png -depth 8 rgba:- output.
    expect(createHash("sha256").update(output.data).digest("hex"))
        .toBe("330585c37c10d78cc4da44bb06857b4b18b0e256682e7267e4af95c82a255fd8");

    expect(await runMagickCli(["out.png", "-coalesce", "full.png"], context)).toMatchObject({ exitCode: 0 });
    const full = decodeImage(retained ? await filesystem.readFile("/full.png") : files.get("full.png")!);
    expect(full).toMatchObject({ width: 48, height: 32, virtualCanvas: { width: 48, height: 32, x: 0, y: 0 } });
    expect(full.data).toEqual(output.data);
});
