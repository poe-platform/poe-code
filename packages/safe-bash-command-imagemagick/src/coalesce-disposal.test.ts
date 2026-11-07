import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";

// Native ImageMagick fixtures and disposal results after -coalesce.
const opaque = "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAANAAAALAAAAAADAAEAgP8AAAAA/wICBFIAOw==";
const transparent = "R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQECgAAACwAAAAAAwADAAACA4R/BQAh+QQJFAAAACwBAAEAAgACAIAAAAAAAP8CAgxeACH5BAweAAAALAAAAAABAAEAgACAAAAAAAICRAEAIfkEBCgAAAAsAgAAAAEAAQCA//8AAAAAAgJEAQA7";

for (const retained of [false, true]) {
  it.each([
    { name: "opaque", fixture: opaque, inputName: "in.gif", disposal: [1, 1], delay: [80, 130], loop: 4 },
    { name: "transparency transitions", fixture: transparent, inputName: "in.gif", disposal: [1, 2, 1, 1], delay: [100, 200, 300, 400], loop: 0 },
    { name: "final transparent transition", fixture: transparent, inputName: "in.gif[0-2]", disposal: [1, 2, 2], delay: [100, 200, 300], loop: 0 }
  ])(`matches native coalesced $name disposal (retained=${retained})`, async ({ fixture, inputName, disposal, delay, loop }) => {
    const input = Buffer.from(fixture, "base64");
    const files = new Map([["in.gif", new Uint8Array(input)]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    expect(await runConvertCli([inputName, "-coalesce", "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    expect(disposal.map((_, page) => decodeImage(output, { page, coalesce: false }).disposal)).toEqual(disposal);
    const decoded = decodeImage(output, { animated: true });
    expect(decoded).toMatchObject({ delay, loop });
    expect(decoded.data).toEqual(decodeImage(input, { animated: true }).data.slice(0, decoded.data.length));
  });
}
