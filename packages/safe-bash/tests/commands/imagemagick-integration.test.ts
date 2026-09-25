import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sharp } from "@poe-code/image-ast";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { imagemagickCommands } from "../../src/commands/imagemagick/index.js";

describe("safe-bash imagemagick integration", () => {
  it("runs magick, convert, mogrify, composite, montage, and binary pipes inside virtual Shell", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(agentCommands())
      .use(imagemagickCommands());

    const pipeRes = await shell.exec(
      "magick -size 80x40 xc:#2563eb -fill '#ffffff' -draw 'rectangle 10,10 70,30' png:- | magick - -resize 50% /piped.png"
    );
    assert.equal(pipeRes.exitCode, 0, pipeRes.stderr);
    const pipedMeta = await sharp(await fs.readFile("/piped.png")).metadata();
    assert.equal(pipedMeta.width, 40);
    assert.equal(pipedMeta.height, 20);

    const stackRes = await shell.exec(
      "convert /piped.png '(' +clone -flop ')' +append /wide.png && identify -format '%m %wx%h' /wide.png"
    );
    assert.equal(stackRes.exitCode, 0, stackRes.stderr);
    assert.equal(stackRes.stdout, "PNG 80x20");

    const mogRes = await shell.exec(
      "mogrify -bordercolor '#ff0000' -border 4x4 /wide.png && identify -format '%wx%h' /wide.png"
    );
    assert.equal(mogRes.exitCode, 0, mogRes.stderr);
    assert.equal(mogRes.stdout, "88x28");

    const monRes = await shell.exec(
      "montage -tile 2x1 -geometry 20x10+2+2 /piped.png /piped.png /grid.png && identify -format '%wx%h' /grid.png"
    );
    assert.equal(monRes.exitCode, 0, monRes.stderr);
    assert.equal(monRes.stdout, "48x14");

    const parityRes = await shell.exec(
      [
        "magick -size 30x20 gradient:#ff0000-#0000ff -fx '(u + 0.2) / 1.2' -distort SRT '1 15' /grad.png",
        "compare -metric AE /piped.png /piped.png /diff.png",
        "magick /piped.png /grad.png -morph 1 /anim-%02d.png"
      ].join(" && ")
    );
    assert.equal(parityRes.exitCode, 0, parityRes.stderr);
    assert.equal(parityRes.stdout.trim(), "0");
    const frame01Meta = await sharp(await fs.readFile("/anim-01.png")).metadata();
    assert.ok(frame01Meta.width > 0);

    await shell.dispose();
  });
});
