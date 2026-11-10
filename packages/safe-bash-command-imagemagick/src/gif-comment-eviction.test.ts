import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

it("preserves GIF comment bytes when frames are evicted from the retained stack", async () => {
  // Native ImageMagick red frame with comment First.
  const input = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.gif", input);
  expect(await runConvertCli([...Array<string>(34).fill("/in.gif"), "/out.gif"], { filesystem, cwd: "/" }))
    .toMatchObject({ exitCode: 0 });
  const output = await filesystem.readFile("/out.gif");
  for (let page = 0; page < 34; page++) {
    expect(decodeImage(output, { page, coalesce: false }).gifCommentBytes)
      .toEqual(decodeImage(input).gifCommentBytes);
  }
});
