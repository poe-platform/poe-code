import { Resvg } from "@resvg/resvg-js";

export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg);
  const png = resvg.render();
  return Buffer.from(png.asPng());
}
