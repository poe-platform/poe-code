import { describe, expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import {
  runCompareCli,
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

  it("runs compare / magick compare with AE, RMSE, MAE, MSE, PSNR, SSIM metrics, -fuzz, and diff image output", async () => {
    const imgA = await makeTestImage(20, 20, 100, 100, 100);
    const imgB = await makeTestImage(20, 20, 100, 100, 100);
    const files = new Map<string, Uint8Array>([
      ["/a.png", imgA],
      ["/b.png", imgB]
    ]);

    // Draw a 5x5 bright red patch on /b.png (25 pixels changed by delta 155,100,100)
    await runConvertCli(
      ["/b.png", "-fill", "#ff0000", "-draw", "rectangle 0,0 4,4", "/b-mod.png"],
      files
    );

    // Identical images -> AE = 0, PSNR = inf, SSIM = 1
    const idAe = await runCompareCli(["-metric", "AE", "/a.png", "/b.png", "null:"], files);
    expect(idAe.exitCode).toBe(0);
    expect((idAe.stderr || idAe.stdout).trim()).toBe("0");

    const idPsnr = await runMagickCli(["compare", "-metric", "PSNR", "/a.png", "/b.png", "null:"], files);
    expect((idPsnr.stderr || idPsnr.stdout).trim()).toBe("inf");

    const idSsim = await runCompareCli(["-metric", "SSIM", "/a.png", "/b.png", "null:"], files);
    expect(Number((idSsim.stderr || idSsim.stdout).trim())).toBeCloseTo(1, 3);

    // Modified 5x5 rectangle -> 25 pixels differ -> AE = 25
    const diffAe = await runCompareCli(
      ["-metric", "AE", "-highlight-color", "#ff00ff", "/a.png", "/b-mod.png", "/diff.png"],
      files
    );
    expect(Number((diffAe.stderr || diffAe.stdout).trim())).toBe(25);
    expect(files.has("/diff.png")).toBe(true);
    const diffRaw = await sharp(files.get("/diff.png")!).raw().toBuffer();
    // Top-left pixel (0,0) was modified -> should be highlighted in #ff00ff
    expect(diffRaw[0]).toBe(255);
    expect(diffRaw[1]).toBe(0);
    expect(diffRaw[2]).toBe(255);

    // RMSE metric outputs "quantum (normalized)"
    const diffRmse = await runCompareCli(["-metric", "RMSE", "/a.png", "/b-mod.png", "null:"], files);
    expect((diffRmse.stderr || diffRmse.stdout).trim()).toMatch(/^\d+(\.\d+)?\s+\(\d+(\.\d+)?\)$/);

    // With small color shift (100 -> 108) and -fuzz 10%, AE should be 0
    const imgSlight = await makeTestImage(20, 20, 108, 100, 100);
    files.set("/slight.png", imgSlight);
    const noFuzz = await runCompareCli(["-metric", "AE", "/a.png", "/slight.png", "null:"], files);
    expect(Number((noFuzz.stderr || noFuzz.stdout).trim())).toBe(400);
    const withFuzz = await runCompareCli(
      ["-metric", "AE", "-fuzz", "10%", "/a.png", "/slight.png", "null:"],
      files
    );
    expect(Number((withFuzz.stderr || withFuzz.stdout).trim())).toBe(0);
  });

  it("supports -opaque, +opaque, -transparent, -evaluate, -function, -clut, and -fx pixel expressions", async () => {
    const src = await makeTestImage(10, 10, 250, 10, 10);
    const files = new Map<string, Uint8Array>([["/red.png", src]]);

    // 1. -fuzz 10% -fill #00ff00 -opaque #ff0000 replaces near-red (250,10,10) with green
    await runMagickCli(
      ["/red.png", "-fuzz", "10%", "-fill", "#00ff00", "-opaque", "#ff0000", "/green.png"],
      files
    );
    const greenRaw = await sharp(files.get("/green.png")!).raw().toBuffer();
    expect(greenRaw[0]).toBe(0);
    expect(greenRaw[1]).toBe(255);
    expect(greenRaw[2]).toBe(0);

    // 2. -transparent #00ff00 makes green pixels transparent (alpha = 0)
    await runMagickCli(["/green.png", "-fuzz", "5%", "-transparent", "#00ff00", "/trans.png"], files);
    const transRaw = await sharp(files.get("/trans.png")!).raw().toBuffer();
    expect(transRaw[3]).toBe(0);

    // 3. -evaluate Multiply 0.5 halves pixel values
    const gray = await makeTestImage(8, 8, 200, 100, 50);
    files.set("/gray.png", gray);
    await runMagickCli(["/gray.png", "-evaluate", "Multiply", "0.5", "/half.png"], files);
    const halfRaw = await sharp(files.get("/half.png")!).raw().toBuffer();
    expect(halfRaw[0]).toBeCloseTo(100, 0);
    expect(halfRaw[1]).toBeCloseTo(50, 0);
    expect(halfRaw[2]).toBeCloseTo(25, 0);

    // 4. -function Polynomial "-1,1" inverts normalized values (1 - x)
    await runMagickCli(["/gray.png", "-function", "Polynomial", "-1,1", "/poly.png"], files);
    const polyRaw = await sharp(files.get("/poly.png")!).raw().toBuffer();
    expect(polyRaw[0]).toBeCloseTo(55, 0);
    expect(polyRaw[1]).toBeCloseTo(155, 0);
    expect(polyRaw[2]).toBeCloseTo(205, 0);

    // 5. -clut maps grayscale values through a lookup table image
    const lut = await makeTestImage(256, 1, 12, 34, 56);
    files.set("/lut.png", lut);
    await runMagickCli(["/gray.png", "/lut.png", "-clut", "/clut-out.png"], files);
    const clutRaw = await sharp(files.get("/clut-out.png")!).raw().toBuffer();
    expect(clutRaw[0]).toBe(12);
    expect(clutRaw[1]).toBe(34);
    expect(clutRaw[2]).toBe(56);

    // 6. -fx evaluates per-pixel math expressions with u, v, i, j, w, h, and variables
    const imgU = await makeTestImage(10, 10, 100, 200, 50);
    const imgV = await makeTestImage(10, 10, 50, 40, 150);
    files.set("/u.png", imgU);
    files.set("/v.png", imgV);
    await runMagickCli(["/u.png", "/v.png", "-fx", "(u + v) / 2", "/fx-avg.png"], files);
    const fxRaw = await sharp(files.get("/fx-avg.png")!).raw().toBuffer();
    expect(fxRaw[0]).toBeCloseTo(75, 1);
    expect(fxRaw[1]).toBeCloseTo(120, 1);
    expect(fxRaw[2]).toBeCloseTo(100, 1);
  });
});
