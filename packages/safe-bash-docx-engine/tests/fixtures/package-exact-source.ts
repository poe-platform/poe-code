import { rasterPng, rasterJpeg } from "./raster.js";
export const packageSourceCases = [
  { row: 865, action: "package-add", filename: "image.png", initial: [], expected: "/word/media/image1.png", count: 1 },
  { row: 866, action: "gather", initial: [1, 2, 3], count: 3 },
  { row: 867, action: "match", filename: "image.jpg", initial: [1], expected: "/word/media/image1.jpg", count: 1 },
  { row: 868, action: "unmatched", filename: "image.png", initial: [1], expected: "/word/media/image1.png", count: 2 },
  { row: 869, action: "next", filename: "image.png", initial: [2, 3], expected: "/word/media/image1.png", count: 3 },
  { row: 870, action: "next", filename: "image.png", initial: [1, 3], expected: "/word/media/image2.png", count: 3 },
  { row: 871, action: "next", filename: "image.png", initial: [1, 2], expected: "/word/media/image3.png", count: 3 },
  { row: 872, action: "add", filename: "image.png", initial: [1, 2, 3, 4, 5, 6], expected: "/word/media/image7.png", count: 7 }
] as const;
export function packageSourceImages(c: typeof packageSourceCases[number]) {
  const jpg = c.action === "match" || c.action === "unmatched";
  return {
    input: c.action === "match" ? rasterJpeg(2, 3) : rasterPng(42, 27),
    retained: c.initial.map(n => ({ name: `word/media/image${n}.${jpg ? "jpg" : "png"}`, bytes: jpg ? rasterJpeg(2, 3) : rasterPng(n + 2, n + 3), type: jpg ? "image/jpeg" : "image/png" }))
  };
}
