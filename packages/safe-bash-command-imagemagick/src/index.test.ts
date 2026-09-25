import { describe, expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import {
  runConvertCli,
  runMagickCli,
  runMogrifyCli,
  runCompositeCli,
  runMontageCli,
  parseMagickGeometry
} from "./index.js";

async function makeTestImage(width = 80, height = 40, r = 30, g = 140, b = 220): Promise<Uint8Array> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 }
    }
  })
    .png()
    .toBuffer();
}

describe("safe-bash-command-imagemagick", () => {
  it("parses ImageMagick geometry strings and modifiers", () => {
    expect(parseMagickGeometry("120x80!")).toMatchObject({
      width: 120,
      height: 80,
      forceExact: true
    });
    expect(parseMagickGeometry("200x100>")).toMatchObject({
      width: 200,
      height: 100,
      shrinkOnly: true
    });
    expect(parseMagickGeometry("200x100<")).toMatchObject({
      width: 200,
      height: 100,
      enlargeOnly: true
    });
    expect(parseMagickGeometry("100x100^")).toMatchObject({
      width: 100,
      height: 100,
      fillArea: true
    });
    expect(parseMagickGeometry("50%")).toMatchObject({
      percentX: 50,
      percentY: 50,
      isPercent: true
    });
    expect(parseMagickGeometry("1600@")).toMatchObject({
      areaLimit: 1600
    });
    expect(parseMagickGeometry("40x30+10-5")).toMatchObject({
      width: 40,
      height: 30,
      x: 10,
      y: -5,
      hasOffset: true
    });
  });

  it("creates synthetic images via xc:, canvas:, and label: and converts formats", async () => {
    const files = new Map<string, Uint8Array>();
    const res = await runMagickCli(
      ["-size", "60x30", "xc:#ff0000", "/red.webp"],
      files
    );
    expect(res.exitCode).toBe(0);
    const meta = await sharp(files.get("/red.webp")!).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(60);
    expect(meta.height).toBe(30);

    const labelRes = await runConvertCli(
      ["-size", "100x24", "-background", "#000000", "-fill", "#ffffff", "label:POE", "/label.png"],
      files
    );
    expect(labelRes.exitCode).toBe(0);
    const labelMeta = await sharp(files.get("/label.png")!).metadata();
    expect(labelMeta.width).toBe(100);
    expect(labelMeta.height).toBe(24);
  });

  it("applies resize modifiers (!, >, <, ^, %, @)", async () => {
    const src = await makeTestImage(80, 40);
    const files = new Map<string, Uint8Array>([["/in.png", src]]);

    // Fit inside (default): 80x40 -> 40x40 becomes 40x20
    await runConvertCli(["/in.png", "-resize", "40x40", "/fit.png"], files);
    const fitMeta = await sharp(files.get("/fit.png")!).metadata();
    expect(fitMeta.width).toBe(40);
    expect(fitMeta.height).toBe(20);

    // Exact (!): 80x40 -> 40x40! becomes 40x40
    await runConvertCli(["/in.png", "-resize", "40x40!", "/exact.png"], files);
    const exactMeta = await sharp(files.get("/exact.png")!).metadata();
    expect(exactMeta.width).toBe(40);
    expect(exactMeta.height).toBe(40);

    // Shrink only (>): 80x40 with 200x200> stays 80x40
    await runConvertCli(["/in.png", "-resize", "200x200>", "/shrink-noop.png"], files);
    const shrinkMeta = await sharp(files.get("/shrink-noop.png")!).metadata();
    expect(shrinkMeta.width).toBe(80);
    expect(shrinkMeta.height).toBe(40);

    // Enlarge only (<): 80x40 with 40x40< stays 80x40
    await runConvertCli(["/in.png", "-resize", "40x40<", "/enlarge-noop.png"], files);
    const enlargeMeta = await sharp(files.get("/enlarge-noop.png")!).metadata();
    expect(enlargeMeta.width).toBe(80);
    expect(enlargeMeta.height).toBe(40);

    // Fill minimum (^): 80x40 into 60x60^ becomes 120x60
    await runConvertCli(["/in.png", "-resize", "60x60^", "/cover.png"], files);
    const coverMeta = await sharp(files.get("/cover.png")!).metadata();
    expect(coverMeta.width).toBe(120);
    expect(coverMeta.height).toBe(60);

    // Percentage (%): 50% -> 40x20
    await runConvertCli(["/in.png", "-resize", "50%", "/pct.png"], files);
    const pctMeta = await sharp(files.get("/pct.png")!).metadata();
    expect(pctMeta.width).toBe(40);
    expect(pctMeta.height).toBe(20);

    // Area (@): 800@ on 2:1 image -> 40x20 (area 800)
    await runConvertCli(["/in.png", "-resize", "800@", "/area.png"], files);
    const areaMeta = await sharp(files.get("/area.png")!).metadata();
    expect(areaMeta.width).toBe(40);
    expect(areaMeta.height).toBe(20);
  });

  it("supports crop, extent, border, shave, rotate, flip, flop, negate, grayscale, and filters", async () => {
    const src = await makeTestImage(60, 40, 200, 100, 50);
    const files = new Map<string, Uint8Array>([["/in.png", src]]);

    const res = await runMagickCli(
      [
        "/in.png",
        "-crop",
        "40x20+10+10",
        "-bordercolor",
        "#00ff00",
        "-border",
        "5x5",
        "-background",
        "#ffffff",
        "-gravity",
        "center",
        "-extent",
        "60x40",
        "-shave",
        "5x5",
        "-rotate",
        "90",
        "-flip",
        "-flop",
        "-negate",
        "-colorspace",
        "Gray",
        "-blur",
        "0x1",
        "-sharpen",
        "0x1",
        "/out.png"
      ],
      files
    );
    expect(res.exitCode).toBe(0);
    const outMeta = await sharp(files.get("/out.png")!).metadata();
    // 40x20 + border 5x5 -> 50x30 -> extent 60x40 -> shave 5x5 -> 50x30 -> rotate 90 -> 30x50
    expect(outMeta.width).toBe(30);
    expect(outMeta.height).toBe(50);
  });

  it("evaluates multi-image stack ops: parentheses ( +clone ), +append, -append, -flatten, and -composite", async () => {
    const left = await makeTestImage(30, 20, 255, 0, 0);
    const right = await makeTestImage(40, 20, 0, 0, 255);
    const files = new Map<string, Uint8Array>([
      ["/left.png", left],
      ["/right.png", right]
    ]);

    // Horizontal +append -> 70x20
    const hRes = await runMagickCli(["/left.png", "/right.png", "+append", "/horiz.png"], files);
    expect(hRes.exitCode).toBe(0);
    const hMeta = await sharp(files.get("/horiz.png")!).metadata();
    expect(hMeta.width).toBe(70);
    expect(hMeta.height).toBe(20);

    // Vertical -append -> 40x40
    const vRes = await runMagickCli(["/left.png", "/right.png", "-append", "/vert.png"], files);
    expect(vRes.exitCode).toBe(0);
    const vMeta = await sharp(files.get("/vert.png")!).metadata();
    expect(vMeta.width).toBe(40);
    expect(vMeta.height).toBe(40);

    // Substack with ( +clone -flop ) +append -> 60x20
    const cloneRes = await runMagickCli(
      ["/left.png", "(", "+clone", "-flop", ")", "+append", "/mirrored.png"],
      files
    );
    expect(cloneRes.exitCode).toBe(0);
    const cMeta = await sharp(files.get("/mirrored.png")!).metadata();
    expect(cMeta.width).toBe(60);
    expect(cMeta.height).toBe(20);

    // -composite onto base
    const compRes = await runMagickCli(
      ["/right.png", "/left.png", "-gravity", "center", "-composite", "/comp.png"],
      files
    );
    expect(compRes.exitCode).toBe(0);
    const compMeta = await sharp(files.get("/comp.png")!).metadata();
    expect(compMeta.width).toBe(40);
    expect(compMeta.height).toBe(20);
  });

  it("draws vector primitives (-draw) and text annotations (-annotate)", async () => {
    const files = new Map<string, Uint8Array>();
    const res = await runMagickCli(
      [
        "-size",
        "80x40",
        "xc:#101010",
        "-fill",
        "#ff0000",
        "-stroke",
        "#ffffff",
        "-strokewidth",
        "2",
        "-draw",
        "rectangle 5,5 40,30 circle 60,20 60,30",
        "-fill",
        "#00ff00",
        "-pointsize",
        "12",
        "-gravity",
        "center",
        "-annotate",
        "+0+0",
        "OK",
        "/drawn.png"
      ],
      files
    );
    expect(res.exitCode).toBe(0);
    const raw = await sharp(files.get("/drawn.png")!).raw().toBuffer();
    // Pixel inside the red rectangle (20, 15) should have high red channel
    const idx = (15 * 80 + 20) * 4;
    expect(raw[idx]!).toBeGreaterThan(200);
  });

  it("runs mogrify in-place and with -format / -path", async () => {
    const a = await makeTestImage(60, 40);
    const files = new Map<string, Uint8Array>([["/a.png", a]]);

    // In-place resize
    const inPlace = await runMogrifyCli(["-resize", "50%", "/a.png"], files);
    expect(inPlace.exitCode).toBe(0);
    const aMeta = await sharp(files.get("/a.png")!).metadata();
    expect(aMeta.width).toBe(30);
    expect(aMeta.height).toBe(20);

    // Format conversion with -path
    const fmtRes = await runMogrifyCli(["-path", "/out", "-format", "webp", "/a.png"], files);
    expect(fmtRes.exitCode).toBe(0);
    const webpMeta = await sharp(files.get("/out/a.webp")!).metadata();
    expect(webpMeta.format).toBe("webp");
    expect(webpMeta.width).toBe(30);
  });

  it("runs composite and montage tools", async () => {
    const tile1 = await makeTestImage(20, 20, 255, 0, 0);
    const tile2 = await makeTestImage(20, 20, 0, 255, 0);
    const tile3 = await makeTestImage(20, 20, 0, 0, 255);
    const base = await makeTestImage(60, 60, 20, 20, 20);
    const files = new Map<string, Uint8Array>([
      ["/t1.png", tile1],
      ["/t2.png", tile2],
      ["/t3.png", tile3],
      ["/base.png", base]
    ]);

    const compRes = await runCompositeCli(
      ["-gravity", "southeast", "-geometry", "+5+5", "/t1.png", "/base.png", "/comp-out.png"],
      files
    );
    expect(compRes.exitCode).toBe(0);
    const compMeta = await sharp(files.get("/comp-out.png")!).metadata();
    expect(compMeta.width).toBe(60);
    expect(compMeta.height).toBe(60);

    // Montage 2x2 grid with 20x20+2+2 geometry -> each cell is (20 + 2*2) x (20 + 2*2) = 24x24 -> 2x2 = 48x48
    const monRes = await runMontageCli(
      ["-tile", "2x2", "-geometry", "20x20+2+2", "-background", "#ffffff", "/t1.png", "/t2.png", "/t3.png", "/montage.png"],
      files
    );
    expect(monRes.exitCode).toBe(0);
    const monMeta = await sharp(files.get("/montage.png")!).metadata();
    expect(monMeta.width).toBe(48);
    expect(monMeta.height).toBe(48);
  });
});
