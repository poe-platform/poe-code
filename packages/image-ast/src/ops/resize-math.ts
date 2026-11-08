import type {ResizeKernel,ResizeFit,GravityPosition,RgbaColor} from "../ast.js";

function sinc(x: number): number {
  if (Math.abs(x) < 1e-7) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function kernelWeight(x: number, kernel: ResizeKernel): number {
  const ax = Math.abs(x);
  switch (kernel) {
    case "nearest":
      return ax < 0.5 ? 1 : 0;
    case "linear":
    case "bilinear":
      return ax < 1 ? 1 - ax : 0;
    case "cubic": {
      // Catmull-Rom (B = 0, C = 0.5)
      if (ax < 1) {
        return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
      }
      if (ax < 2) {
        return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
      }
      return 0;
    }
    case "mitchell": {
      // Mitchell-Netravali (B = 1/3, C = 1/3)
      const B = 1 / 3;
      const C = 1 / 3;
      if (ax < 1) {
        return ((12 - 9 * B - 6 * C) * ax * ax * ax + (-18 + 12 * B + 6 * C) * ax * ax + (6 - 2 * B)) / 6;
      }
      if (ax < 2) {
        return (
          ((-B - 6 * C) * ax * ax * ax +
            (6 * B + 30 * C) * ax * ax +
            (-12 * B - 48 * C) * ax +
            (8 * B + 24 * C)) /
          6
        );
      }
      return 0;
    }
    case "lanczos2":
      return ax < 2 ? sinc(x) * sinc(x / 2) : 0;
    case "lanczos3":
    default:
      return ax < 3 ? sinc(x) * sinc(x / 3) : 0;
  }
}

export function fmaDouble(a: number, b: number, c: number): number {
  const splitter = 134217729;
  const p = a * b;
  const ca = splitter * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = splitter * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  const err = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return (p + c) + err;
}

function rintEven(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - r) === 0.5) return r % 2 === 0 ? r : r - 1;
  return r;
}

export function buildVipsReduceTable(
  shrink: number,
  kernel: ResizeKernel
): { readonly nPoint: number; readonly table: Int32Array } {
  const mult =
    kernel === "linear" || kernel === "bilinear" ? 1.0 : kernel === "lanczos3" ? 3.0 : 2.0;
  const nPoint = 2 * rintEven(mult * shrink) + 1;
  const table = new Int32Array(65 * nPoint);
  const wf = new Float64Array(nPoint);
  for (let k = 0; k < 65; k++) {
    const s = Math.fround(k * Math.fround(1.0 / 64.0));
    const d15 = nPoint * 0.5 + s - 1.0;
    let sum = 0.0;
    for (let j = 0; j < nPoint; j++) {
      const x = (j - d15) / shrink;
      const v = kernelWeight(x, kernel);
      wf[j] = v;
      sum += v;
    }
    for (let j = 0; j < nPoint; j++) {
      table[k * nPoint + j] = Math.trunc((wf[j]! / sum) * 4096.0);
    }
  }
  return { nPoint, table };
}

export const VIPS_BICUBIC_TABLE = (() => {
  const t = new Int32Array(65 * 4);
  for (let k = 0; k < 64; k++) {
    const s = Math.fround(k * Math.fround(1.0 / 64.0));
    const u = Math.fround(1.0 - s);
    const t0 = Math.fround(Math.fround(-0.5 * s) * u);
    const c0 = Math.fround(t0 * u);
    const c3 = Math.fround(t0 * s);
    const diff = Math.fround(c3 - c0);
    const c1 = Math.fround(Math.fround(u - c0) + diff);
    const c2 = Math.fround(Math.fround(s - c3) - diff);
    t[k * 4] = Math.trunc(c0 * 4096.0);
    t[k * 4 + 1] = Math.trunc(c1 * 4096.0);
    t[k * 4 + 2] = Math.trunc(c2 * 4096.0);
    t[k * 4 + 3] = Math.trunc(c3 * 4096.0);
  }
  t[64 * 4] = 0;
  t[64 * 4 + 1] = 0;
  t[64 * 4 + 2] = 4096;
  t[64 * 4 + 3] = 0;
  return t;
})();

/** Lazy coordinates retain the original accumulation and mixed-axis zoom rules. */
export function nearestCoordinates(srcW:number,srcH:number,dstW:number,dstH:number,explicitHscale?:number,explicitVscale?:number):{x:()=>Generator<number>;y:()=>Generator<number>} {
  let hscale=explicitHscale??1/(srcW/dstW),vscale=explicitVscale??1/(srcH/dstH);
  const targetW=Math.trunc(fmaDouble(srcW,hscale,0.5)),targetH=Math.trunc(fmaDouble(srcH,vscale,0.5));
  const intHshrink=Math.max(1,Math.floor((srcW/targetW)/2)),intVshrink=Math.max(1,Math.floor((srcH/targetH)/2));
  let subW=srcW,subH=srcH,xshrink=1,yshrink=1;
  if(intHshrink>1 || intVshrink>1) {
    xshrink=intHshrink;yshrink=intVshrink;
    subW=Math.floor(srcW/xshrink);subH=Math.floor(srcH/yshrink);
    hscale*=xshrink;vscale*=yshrink;
  }
  hscale=Math.max(hscale,1/subW);vscale=Math.max(vscale,1/subH);
  const remHscale=hscale<1?1:hscale,remVscale=vscale<1?1:vscale;
  const zoom=remHscale>1 || remVscale>1;
  const integer=remHscale===Math.floor(remHscale) && remVscale===Math.floor(remVscale);
  const invDet=1/(remHscale*remVscale);
  function *axis(size:number,count:number,scale:number,shrink:number,isY:boolean):Generator<number> {
    if(scale<1) {
      const factor=1/scale,out=Math.trunc(size/factor+0.5),extra=fmaDouble(out,factor,-size);
      let position=fmaDouble(0.5,factor,-0.5)-((extra+1)*0.5-1);
      for(let i=0;i<count;i++) {yield Math.max(0,Math.min(size-1,Math.trunc(position)))*shrink;position+=factor;}
    } else if(zoom && !integer) {
      const increment=(isY?remHscale:remVscale)*invDet;
      let position=1;
      for(let i=0;i<count;i++) {
        yield Math.max(0,Math.min(size-1,Math.trunc(isY?i*increment+1:position)-1))*shrink;
        position+=increment;
      }
    } else {
      const factor=zoom?Math.floor(scale):1;
      for(let i=0;i<count;i++) yield Math.max(0,Math.min(size-1,Math.floor(i/factor)))*shrink;
    }
  }
  return {x:()=>axis(subW,dstW,hscale,xshrink,false),y:()=>axis(subH,dstH,vscale,yshrink,true)};
}

export interface ResizeSpec {
    readonly width: number | null;
    readonly height: number | null;
    readonly fit: ResizeFit;
    readonly position: GravityPosition;
    readonly kernel: ResizeKernel;
    readonly background: RgbaColor;
    readonly withoutEnlargement: boolean;
    readonly withoutReduction: boolean;
  }

export function resizeScale(srcW:number,srcH:number,spec:ResizeSpec) {
  const reqW = spec.width ?? 0;
  const reqH = spec.height ?? 0;
  let xShrink = 1.0;
  let yShrink = 1.0;
  if (reqW > 0 && reqH > 0) {
    xShrink = srcW / reqW;
    yShrink = srcH / reqH;
    if (spec.fit === "cover" || spec.fit === "outside") {
      if (xShrink < yShrink) yShrink = xShrink;
      else xShrink = yShrink;
    } else if (spec.fit === "contain" || spec.fit === "inside") {
      if (xShrink > yShrink) yShrink = xShrink;
      else xShrink = yShrink;
    }
  } else if (reqW > 0) {
    xShrink = srcW / reqW;
    if (spec.fit !== "fill") yShrink = xShrink;
  } else if (reqH > 0) {
    yShrink = srcH / reqH;
    if (spec.fit !== "fill") xShrink = yShrink;
  }
  if (spec.withoutEnlargement) {
    xShrink = Math.max(1.0, xShrink);
    yShrink = Math.max(1.0, yShrink);
  }
  if (spec.withoutReduction) {
    xShrink = Math.min(1.0, xShrink);
    yShrink = Math.min(1.0, yShrink);
  }
  xShrink = Math.min(srcW, xShrink);
  yShrink = Math.min(srcH, yShrink);

  const hscale = 1.0 / xShrink;
  const vscale = 1.0 / yShrink;
  const scaledW = Math.max(1, Math.trunc(fmaDouble(srcW, hscale, 0.5)));
  const scaledH = Math.max(1, Math.trunc(fmaDouble(srcH, vscale, 0.5)));
  return {reqW,reqH,hscale,vscale,width:scaledW,height:scaledH};
}
