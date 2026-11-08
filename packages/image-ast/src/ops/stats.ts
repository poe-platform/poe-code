import type {RgbaImage,ImageStats,ChannelStats} from "../ast.js";
import {srgbToBwByte} from "./color.js";

/** Requests one packed RGBA pixel at a time; undefined yields are cooperative checkpoints. */
export function *imageStatsSteps(img: Omit<RgbaImage,"data" | "data16">): Generator<number | undefined, ImageStats, number> {
  let work = 0;
  const { width, height } = img;
  const totalPixels = Math.max(1, width * height);
  const chIndices =
    img.channels === 1
      ? [0]
      : img.channels === 2
        ? [0, 3]
        : img.hasAlpha
          ? [0, 1, 2, 3]
          : [0, 1, 2];
  const channels: ChannelStats[] = [];

  for (const c of chIndices) {
    if (++work % 16384 === 0) yield;
    let min = 255;
    let max = 0;
    let sum = 0;
    let squaresSum = 0;
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const v = ((yield y * width + x) >>> (c * 8)) & 255;
        sum += v;
        squaresSum += v * v;
        if (v < min) {
          min = v;
          minX = x;
          minY = y;
        }
        if (v > max) {
          max = v;
          maxX = x;
          maxY = y;
        }
      }
    }
    const mean = sum / totalPixels;
    const variance =
      totalPixels > 1
        ? Math.max(0, (squaresSum - (sum * sum) / totalPixels) / (totalPixels - 1))
        : 0;
    channels.push({
      min,
      max,
      sum,
      squaresSum,
      mean,
      stdev: Math.sqrt(variance),
      minX,
      minY,
      maxX,
      maxY
    });
  }

  let isOpaque = true;
  const hist = new Uint32Array(256);
  const colorBins = new Uint32Array(4096);

  for (let i = 0; i < totalPixels; i++) {
    if (++work % 16384 === 0) yield;
    const pixel = yield i;
    const r = pixel & 255;
    const g = (pixel >>> 8) & 255;
    const b = (pixel >>> 16) & 255;
    const a = pixel >>> 24;
    if (a < 255) isOpaque = false;
    const luma = img.channels <= 2 || img.space === "b-w" ? r : srgbToBwByte(r, g, b);
    hist[luma]!++;
    const bin = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
    colorBins[bin]!++;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (++work % 16384 === 0) yield;
    const count = hist[i]!;
    if (count > 0) {
      const p = count / totalPixels;
      entropy -= p * Math.log2(p);
    }
  }

  let maxBin = 0;
  let maxBinCount = 0;
  for (let i = 0; i < 4096; i++) {
    if (++work % 16384 === 0) yield;
    if (colorBins[i]! > maxBinCount) {
      maxBinCount = colorBins[i]!;
      maxBin = i;
    }
  }
  const dominant =
    maxBinCount > 0
      ? {
          r: ((maxBin >>> 8) & 0x0f) * 16 + 8,
          g: ((maxBin >>> 4) & 0x0f) * 16 + 8,
          b: (maxBin & 0x0f) * 16 + 8
        }
      : { r: 0, g: 0, b: 0 };

  const luma = (pixel:number):number => img.channels <= 2 || img.space === "b-w"
    ? pixel & 255
    : srgbToBwByte(pixel & 255,(pixel >>> 8) & 255,(pixel >>> 16) & 255);
  let sharpness = 0;
  if ((width > 1 || height > 1) && totalPixels > 1) {
    let lapSum = 0;
    let lapSqSum = 0;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      const ym = y > 0 ? y - 1 : 0;
      const yp = y + 1 < height ? y + 1 : height - 1;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const xm = x > 0 ? x - 1 : 0;
        const xp = x + 1 < width ? x + 1 : width - 1;
        const lap =
          (luma(yield ym * width + x) +
            luma(yield yp * width + x) +
            luma(yield y * width + xm) +
            luma(yield y * width + xp) -
            4 * luma(yield y * width + x)) /
          9.0;
        lapSum += lap;
        lapSqSum += lap * lap;
      }
    }
    sharpness = Math.sqrt(
      Math.max(0, (lapSqSum - (lapSum * lapSum) / totalPixels) / (totalPixels - 1))
    );
  }

  return {
    channels,
    isOpaque,
    entropy,
    sharpness,
    dominant
  };
}

