import {FONT_5X7} from "./font-5x7.js";
import {parseColor} from "../ast.js";
import {parseSvgCoord,parseSvgNumber} from "./svg-number.js";

export type SvgPixel = readonly [x:number,y:number,r:number,g:number,b:number,a:number];
export type SvgMatrix = readonly [number,number,number,number,number,number];
export type SvgPoint = readonly [number,number];
export interface SvgRenderElement {
 readonly tag:string;
 readonly attrs:Readonly<Record<string,string|undefined>>;
 readonly matrix:SvgMatrix;
 readonly pointCount:number;
 readonly closed:boolean;
 readonly textLength:number;
}
export type SvgRenderEvent = SvgPixel | undefined | {readonly kind:"point"|"character";readonly index:number};
export type SvgRenderReply = SvgPoint | number | undefined;

/** Shared raster arithmetic. Drivers own syntax, point and character storage. */
export function* rasterSvgElement(element:SvgRenderElement,viewport:{readonly width:number;readonly height:number;readonly vbW:number;readonly vbH:number}):Generator<SvgRenderEvent,void,SvgRenderReply> {
 const {tag,attrs,matrix:activeCtm,pointCount,closed,textLength}=element;
 const {width,height,vbW,vbH}=viewport;let rasterWork=0;
 const mapPt=(ux:number,uy:number):[number,number]=>[activeCtm[0]*ux+activeCtm[2]*uy+activeCtm[4],activeCtm[1]*ux+activeCtm[3]*uy+activeCtm[5]];
 const mapX=(ux:number)=>activeCtm[0]*ux+activeCtm[4];
 const mapY=(uy:number)=>activeCtm[3]*uy+activeCtm[5];
 const point=function*(index:number):Generator<SvgRenderEvent,SvgPoint,SvgRenderReply>{return (yield {kind:"point",index}) as SvgPoint;};
  const blendPixel = function* (px: number, py: number, r: number, g: number, b: number, a: number): Generator<SvgRenderEvent, void, SvgRenderReply> {
    if (px < 0 || py < 0 || px >= width || py >= height || a <= 0) return;
    yield [px, py, r, g, b, a];
  };

  const drawSegment = function* (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeWidth: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): Generator<SvgRenderEvent, void, SvgRenderReply> {
    if (a <= 0) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    const half = Math.max(0, (strokeWidth - 1) / 2);
    const rad = Math.ceil(half);
    for (let s = 0; s <= steps; s++) {
      const px = x1 + ((x2 - x1) * s) / steps;
      const py = y1 + ((y2 - y1) * s) / steps;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (++rasterWork % 16384 === 0) yield undefined;
          if (dx * dx + dy * dy <= (half + 0.5) * (half + 0.5)) {
            yield* blendPixel(Math.round(px + dx), Math.round(py + dy), r, g, b, a);
          }
        }
      }
    }
  };

    const effScaleX = Math.hypot(activeCtm[0], activeCtm[1]);
    const effScaleY = Math.hypot(activeCtm[2], activeCtm[3]);

    const fillAttr = attrs["fill"] ?? (tag === "line" ? "none" : "#000000");
    const opAttr = parseFloat(attrs["opacity"] ?? "1");
    const fillOpAttr = parseFloat(attrs["fill-opacity"] ?? "1");
    const opacity = (Number.isFinite(opAttr) ? opAttr : 1) * (Number.isFinite(fillOpAttr) ? fillOpAttr : 1);
    const fill = fillAttr === "none" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(fillAttr);
    const effAlpha = Math.round(fill.a * (Number.isFinite(opacity) ? opacity : 1));
    const strokeAttr = attrs["stroke"];
    const stroke = strokeAttr && strokeAttr !== "none" ? parseColor(strokeAttr) : { r: 0, g: 0, b: 0, a: 0 };
    const strokeW = parseSvgCoord(attrs["stroke-width"], 1, vbW) * ((effScaleX + effScaleY) / 2);

    if (tag === "text" && effAlpha > 0 && textLength > 0) {
      const tx = mapX(parseSvgCoord(attrs["x"], 0, vbW));
      const ty = mapY(parseSvgCoord(attrs["y"], 0, vbH));
      const fontSize = Math.max(6, parseSvgCoord(attrs["font-size"], 12, vbH) * effScaleY);
      const glyphH = Math.max(7, Math.round(fontSize * 0.76));
      const glyphW = Math.max(5, Math.round(glyphH * (5 / 7)));
      const advanceX = Math.max(glyphW + 1, Math.round(glyphW * 1.2));
      const anchor = (attrs["text-anchor"] ?? "start").toLowerCase();
      const totalW = textLength * advanceX;
      const startX = anchor === "middle" ? tx - totalW / 2 : anchor === "end" ? tx - totalW : tx;
      const baseTopY = Math.round(ty - glyphH);
      for (let ci = 0; ci < textLength; ci++) {
        const ch = ((yield {kind: "character", index: ci}) as number);
        if (ch <= 32) continue;
        const glyphIdx = Math.max(0, Math.min(94, ch - 32));
        const isDescender = ch === 103 || ch === 106 || ch === 112 || ch === 113 || ch === 121 || ch === 44 || ch === 59;
        const charTopY = baseTopY + (isDescender ? Math.max(1, Math.round(glyphH / 7)) : 0);
        const charLeftX = Math.round(startX + ci * advanceX);
        for (let py = 0; py < glyphH; py++) {
          const gy = Math.min(6, Math.floor((py * 7) / glyphH));
          const screenY = charTopY + py;
          if (screenY < 0 || screenY >= height) continue;
          for (let px = 0; px < glyphW; px++) {
          if (++rasterWork % 16384 === 0) yield undefined;
            const gx = Math.min(4, Math.floor((px * 5) / glyphW));
            const colBits = FONT_5X7[glyphIdx * 5 + gx]!;
            if ((colBits & (1 << gy)) !== 0) {
              const screenX = charLeftX + px;
              if (screenX >= 0 && screenX < width) {
                yield* blendPixel(screenX, screenY, fill.r, fill.g, fill.b, effAlpha);
              }
            }
          }
        }
      }
      return;
    }
    if (tag === "rect" && effAlpha > 0) {
      const rx = Math.round(mapX(parseSvgCoord(attrs["x"], 0, vbW)));
      const ry = Math.round(mapY(parseSvgCoord(attrs["y"], 0, vbH)));
      const rw = Math.round(parseSvgNumber(attrs["width"], vbW) * effScaleX);
      const rh = Math.round(parseSvgNumber(attrs["height"], vbH) * effScaleY);
      const rawCornerRx = parseSvgCoord(attrs["rx"], 0, vbW) * effScaleX;
      const rawCornerRy = parseSvgCoord(attrs["ry"], 0, vbH) * effScaleY;
      const cRx = Math.min(rw / 2, rawCornerRx > 0 ? rawCornerRx : rawCornerRy);
      const cRy = Math.min(rh / 2, rawCornerRy > 0 ? rawCornerRy : rawCornerRx);
      for (let y = Math.max(0, ry); y < Math.min(height, ry + rh); y++) {
        for (let x = Math.max(0, rx); x < Math.min(width, rx + rw); x++) {
          if (++rasterWork % 16384 === 0) yield undefined;
          let pixAlpha = effAlpha;
          if (cRx > 0 && cRy > 0) {
            const px = x + 0.5;
            const py = y + 0.5;
            let cx = px;
            let cy = py;
            if (px < rx + cRx) cx = rx + cRx;
            else if (px > rx + rw - cRx) cx = rx + rw - cRx;
            if (py < ry + cRy) cy = ry + cRy;
            else if (py > ry + rh - cRy) cy = ry + rh - cRy;
            if (cx !== px && cy !== py) {
              const dx = (px - cx) / cRx;
              const dy = (py - cy) / cRy;
              const d = Math.hypot(dx, dy);
              const cov = Math.max(0, Math.min(1, 0.5 - (d - 1) * Math.min(cRx, cRy)));
              if (cov <= 0) continue;
              pixAlpha = Math.round(effAlpha * cov);
            }
          }
          yield* blendPixel(x, y, fill.r, fill.g, fill.b, pixAlpha);
        }
      }
    } else if ((tag === "circle" || tag === "ellipse") && effAlpha > 0) {
      const cx = mapX(parseSvgCoord(attrs["cx"], 0, vbW));
      const cy = mapY(parseSvgCoord(attrs["cy"], 0, vbH));
      const r = parseSvgCoord(attrs["r"], 0, (vbW + vbH) / 2);
      const rx = Math.max(0.5, (tag === "circle" ? r : parseSvgCoord(attrs["rx"], 0, vbW)) * effScaleX);
      const ry = Math.max(0.5, (tag === "circle" ? r : parseSvgCoord(attrs["ry"], 0, vbH)) * effScaleY);
      const minY = Math.max(0, Math.floor(cy - ry));
      const maxY = Math.min(height - 1, Math.ceil(cy + ry));
      const minX = Math.max(0, Math.floor(cx - rx));
      const maxX = Math.min(width - 1, Math.ceil(cx + rx));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (++rasterWork % 16384 === 0) yield undefined;
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          const d = Math.hypot(dx, dy);
          const cov = Math.max(0, Math.min(1, 0.5 - (d - 1) * Math.min(rx, ry)));
          if (cov > 0) {
            yield* blendPixel(x, y, fill.r, fill.g, fill.b, Math.round(effAlpha * cov));
          }
        }
      }
    } else if (tag === "line") {
      const lineStroke = parseColor(attrs["stroke"] ?? "#000000");
      const x1 = mapX(parseSvgCoord(attrs["x1"], 0, vbW));
      const y1 = mapY(parseSvgCoord(attrs["y1"], 0, vbH));
      const x2 = mapX(parseSvgCoord(attrs["x2"], 0, vbW));
      const y2 = mapY(parseSvgCoord(attrs["y2"], 0, vbH));
      yield* drawSegment(x1, y1, x2, y2, strokeW, lineStroke.r, lineStroke.g, lineStroke.b, lineStroke.a);
    } else if (tag === "polygon" || tag === "polyline" || tag === "path") {
      
      const shouldFill =
        pointCount >= 3 &&
        effAlpha > 0 &&
        (tag === "polygon" || (tag === "path" && fillAttr !== "none") || attrs["fill"] !== undefined);
      if (shouldFill) {
        let minX = width;
        let maxX = 0;
        let minY = height;
        let maxY = 0;
        for (let index = 0; index < pointCount; index++) {
          const [px, py] = yield* point(index);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        const y0 = Math.max(0, Math.floor(minY));
        const y1 = Math.min(height - 1, Math.ceil(maxY));
        const x0 = Math.max(0, Math.floor(minX));
        const x1 = Math.min(width - 1, Math.ceil(maxX));
        for (let y = y0; y <= y1; y++) {
          const py = y + 0.5;
          for (let x = x0; x <= x1; x++) {
          if (++rasterWork % 16384 === 0) yield undefined;
            const px = x + 0.5;
            let inside = false;
            let previous = yield* point(pointCount - 1);
            for (let i = 0; i < pointCount; i++) {
              const current = yield* point(i);
              const [xi, yi] = current;
              const [xj, yj] = previous;
              previous = current;
              if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
                inside = !inside;
              }
            }
            if (inside) {
              yield* blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
            }
          }
        }
      }
      if (pointCount >= 2 && (stroke.a > 0 || tag === "polyline")) {
        const sCol = stroke.a > 0 ? stroke : parseColor(attrs["stroke"] ?? "#000000");
        for (let i = 0; i + 1 < pointCount; i++) {
          const a = yield* point(i), b = yield* point(i + 1);
          yield* drawSegment(a[0], a[1], b[0], b[1], strokeW, sCol.r, sCol.g, sCol.b, sCol.a);
        }
        if ((tag === "polygon" || (tag === "path" && closed)) && stroke.a > 0) {
          const last = yield* point(pointCount - 1), first = yield* point(0);
          yield* drawSegment(
            last[0],
            last[1],
            first[0],
            first[1],
            strokeW,
            sCol.r,
            sCol.g,
            sCol.b,
            sCol.a
          );
        }
      }
    }
    // Primitive outlines are independent of fill (Graphviz uses fill="none").
    if (stroke.a > 0 && strokeW > 0 && ["rect", "ellipse", "circle"].includes(tag)) {
      const points: Array<[number, number]> = [];
      if (tag === "rect") {
        const x = parseSvgCoord(attrs["x"], 0, vbW);
        const y = parseSvgCoord(attrs["y"], 0, vbH);
        const w = parseSvgNumber(attrs["width"], vbW);
        const h = parseSvgNumber(attrs["height"], vbH);
        const rawRx = parseSvgCoord(attrs["rx"], 0, vbW);
        const rawRy = parseSvgCoord(attrs["ry"], 0, vbH);
        const rx = Math.max(0, Math.min(w / 2, rawRx || rawRy));
        const ry = Math.max(0, Math.min(h / 2, rawRy || rawRx));
        if (w <= 0 || h <= 0) return;
        if (rx && ry) {
          const corners = [[x + w - rx, y + ry], [x + w - rx, y + h - ry], [x + rx, y + h - ry], [x + rx, y + ry]];
          for (let corner = 0; corner < 4; corner++)
            for (let step = 0; step <= 16; step++) {
              const angle = (corner - 1 + step / 16) * Math.PI / 2;
              points.push(mapPt(corners[corner]![0]! + rx * Math.cos(angle), corners[corner]![1]! + ry * Math.sin(angle)));
            }
        } else points.push(mapPt(x, y), mapPt(x + w, y), mapPt(x + w, y + h), mapPt(x, y + h));
      } else {
        const cx = parseSvgCoord(attrs["cx"], 0, vbW);
        const cy = parseSvgCoord(attrs["cy"], 0, vbH);
        const r = parseSvgCoord(attrs["r"], 0, (vbW + vbH) / 2);
        const rx = tag === "circle" ? r : parseSvgCoord(attrs["rx"], 0, vbW);
        const ry = tag === "circle" ? r : parseSvgCoord(attrs["ry"], 0, vbH);
        if (rx <= 0 || ry <= 0) return;
        for (let step = 0; step < 128; step++) {
          const angle = step * Math.PI / 64;
          points.push(mapPt(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
        }
      }
      const strokeOpacity = Number(attrs["stroke-opacity"] ?? 1);
      const alpha = Math.round(stroke.a * (Number.isFinite(opAttr) ? opAttr : 1) * (Number.isFinite(strokeOpacity) ? strokeOpacity : 1));
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!, b = points[(i + 1) % points.length]!;
        yield* drawSegment(a[0], a[1], b[0], b[1], strokeW, stroke.r, stroke.g, stroke.b, alpha);
      }
    }
}
