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

  it("supports geometric distortions (-distort SRT/Perspective, -shear, -swirl, -implode, -wave) and effects (-shadow, -vignette, -sepia-tone, -solarize, -posterize, -edge, -emboss, -charcoal)", async () => {
    const src = await makeTestImage(40, 30, 200, 80, 40);
    const files = new Map<string, Uint8Array>([["/src.png", src]]);

    // 1. -shear 20x0 expands width
    await runMagickCli(["/src.png", "-background", "#000000", "-shear", "20x0", "/sheared.png"], files);
    const shearMeta = await sharp(files.get("/sheared.png")!).metadata();
    expect(shearMeta.width).toBeGreaterThan(40);
    expect(shearMeta.height).toBe(30);

    // 2. -distort SRT "1.5 45" scales and rotates in-place
    await runMagickCli(["/src.png", "-distort", "SRT", "1.5 45", "/srt.png"], files);
    const srtMeta = await sharp(files.get("/srt.png")!).metadata();
    expect(srtMeta.width).toBe(40);
    expect(srtMeta.height).toBe(30);

    // 3. -distort Perspective with 4 point pairs
    await runMagickCli(
      [
        "/src.png",
        "-distort",
        "Perspective",
        "0,0 2,2  39,0 37,4  39,29 38,28  0,29 1,27",
        "/persp.png"
      ],
      files
    );
    const perspMeta = await sharp(files.get("/persp.png")!).metadata();
    expect(perspMeta.width).toBe(40);
    expect(perspMeta.height).toBe(30);

    // 4. -swirl, -implode, -wave
    await runMagickCli(
      ["/src.png", "-swirl", "60", "-implode", "0.3", "-wave", "4x20", "/warped.png"],
      files
    );
    const warpMeta = await sharp(files.get("/warped.png")!).metadata();
    expect(warpMeta.width).toBe(40);
    expect(warpMeta.height).toBe(38); // 30 + 2*4 amplitude

    // 5. -shadow 80x2+4+4 expands canvas and creates soft drop shadow
    await runMagickCli(["/src.png", "-background", "#000000", "-shadow", "80x2+4+4", "/shadow.png"], files);
    const shadowMeta = await sharp(files.get("/shadow.png")!).metadata();
    expect(shadowMeta.width).toBeGreaterThan(40);
    expect(shadowMeta.height).toBeGreaterThan(30);

    // 6. -sepia-tone, -solarize, -posterize, -vignette, -edge, -emboss, -charcoal
    await runMagickCli(
      [
        "/src.png",
        "-sepia-tone",
        "80%",
        "-solarize",
        "50%",
        "-posterize",
        "4",
        "-vignette",
        "0x2",
        "-edge",
        "1",
        "-emboss",
        "1",
        "-charcoal",
        "1",
        "/art.png"
      ],
      files
    );
    const artMeta = await sharp(files.get("/art.png")!).metadata();
    expect(artMeta.width).toBe(40);
    expect(artMeta.height).toBe(30);
  });

  it("supports gradient:/radial-gradient:/pattern:checkerboard, polygon/path/bezier -draw, -splice/-chop/-roll, -morph, and out-%d.png multi-frame output", async () => {
    const files = new Map<string, Uint8Array>();

    // 1. gradient: and radial-gradient: and pattern:checkerboard
    await runMagickCli(["-size", "40x20", "gradient:#ff0000-#0000ff", "/grad.png"], files);
    const gradRaw = await sharp(files.get("/grad.png")!).raw().toBuffer();
    // Top row is red, bottom row is blue
    expect(gradRaw[0]).toBeGreaterThan(240);
    expect(gradRaw[2]).toBeLessThan(15);
    const bottomIdx = (19 * 40 + 0) * 4;
    expect(gradRaw[bottomIdx]).toBeLessThan(15);
    expect(gradRaw[bottomIdx + 2]).toBeGreaterThan(240);

    await runMagickCli(["-size", "30x30", "radial-gradient:#ffffff-#000000", "/rgrad.png"], files);
    const rgradMeta = await sharp(files.get("/rgrad.png")!).metadata();
    expect(rgradMeta.width).toBe(30);
    expect(rgradMeta.height).toBe(30);

    await runMagickCli(["-size", "32x32", "pattern:checkerboard", "/check.png"], files);
    const checkMeta = await sharp(files.get("/check.png")!).metadata();
    expect(checkMeta.width).toBe(32);

    // 2. Advanced -draw: polygon, polyline, bezier, path
    await runMagickCli(
      [
        "-size",
        "50x50",
        "xc:#000000",
        "-fill",
        "#00ff00",
        "-draw",
        "polygon 10,10 40,10 40,40 10,40 path 'M 5 5 L 15 5 L 10 15 Z' bezier 0,0 25,50 50,0",
        "/poly-draw.png"
      ],
      files
    );
    const polyRaw = await sharp(files.get("/poly-draw.png")!).raw().toBuffer();
    // Center (25, 25) is inside the green polygon
    const centerIdx = (25 * 50 + 25) * 4;
    expect(polyRaw[centerIdx + 1]).toBeGreaterThan(200);

    // 3. -splice, -chop, -roll
    await runMagickCli(
      [
        "-size",
        "20x20",
        "xc:#ff0000",
        "-background",
        "#0000ff",
        "-splice",
        "10x5+0+0",
        "/spliced.png"
      ],
      files
    );
    const spliceMeta = await sharp(files.get("/spliced.png")!).metadata();
    expect(spliceMeta.width).toBe(30);
    expect(spliceMeta.height).toBe(25);

    await runMagickCli(["/spliced.png", "-chop", "10x5+0+0", "-roll", "+5+5", "/chopped.png"], files);
    const chopMeta = await sharp(files.get("/chopped.png")!).metadata();
    expect(chopMeta.width).toBe(20);
    expect(chopMeta.height).toBe(20);

    // 4. -morph 2 between two images + multi-file scene pattern /frame-%02d.png -> 4 output files
    const f0 = await makeTestImage(16, 16, 0, 0, 0);
    const f1 = await makeTestImage(16, 16, 240, 240, 240);
    files.set("/f0.png", f0);
    files.set("/f1.png", f1);
    const morphRes = await runMagickCli(["/f0.png", "/f1.png", "-morph", "2", "/frame-%02d.png"], files);
    expect(morphRes.exitCode).toBe(0);
    expect(files.has("/frame-00.png")).toBe(true);
    expect(files.has("/frame-01.png")).toBe(true);
    expect(files.has("/frame-02.png")).toBe(true);
    expect(files.has("/frame-03.png")).toBe(true);
    const mid1Raw = await sharp(files.get("/frame-01.png")!).raw().toBuffer();
    expect(mid1Raw[0]).toBeCloseTo(80, 2);
  });
});
