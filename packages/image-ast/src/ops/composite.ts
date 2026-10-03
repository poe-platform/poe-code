import type {BlendMode,CompositeLayer} from "../ast.js";
import {resolveGravityOffset} from "./resize.js";
function getBlendModeId(mode: BlendMode): number {
  switch (mode) {
    case "multiply": return 1;
    case "screen": return 2;
    case "overlay": return 3;
    case "darken": return 4;
    case "lighten": return 5;
    case "color-dodge":
    case "colour-dodge": return 6;
    case "color-burn":
    case "colour-burn": return 7;
    case "hard-light": return 8;
    case "soft-light": return 9;
    case "difference": return 10;
    case "exclusion": return 11;
    default: return 0;
  }
}

function blendChannelById(s: number, d: number, modeId: number): number {
  switch (modeId) {
    case 1: return s * d;
    case 2: return s + d - s * d;
    case 3: return d < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
    case 4: return Math.min(s, d);
    case 5: return Math.max(s, d);
    case 6: return d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s));
    case 7: return d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s);
    case 8: return s < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
    case 9:
      return s < 0.5
        ? d - (1 - 2 * s) * d * (1 - d)
        : d + (2 * s - 1) * (d <= 0.25 ? ((16 * d - 12) * d + 3) * d : Math.sqrt(d) - d);
    case 10: return Math.abs(d - s);
    case 11: return s + d - 2 * s * d;
    case 12: return Math.min(1, s + d);
    default: return s;
  }
}

export function compositeOffset(baseW:number,baseH:number,overlay:{width:number;height:number},layer:CompositeLayer):{startX:number;startY:number} {
    const grav = resolveGravityOffset(
      baseW,
      baseH,
      overlay.width,
      overlay.height,
      layer.gravity ?? "center",
      !layer.tile
    );
    let startX: number;
    let startY: number;
    if (layer.tile && layer.left !== undefined && layer.top !== undefined) {
      const reqLeft = Math.round(layer.left);
      const reqTop = Math.round(layer.top);
      if (reqLeft < 0 || reqTop < 0) {
        throw new Error("extract_area: bad extract area");
      }
      const repW = (overlay.width < baseW ? Math.floor(baseW / overlay.width) + 1 : 1) * overlay.width;
      const repH = (overlay.height < baseH ? Math.floor(baseH / overlay.height) + 1 : 1) * overlay.height;
      startX = -Math.min(reqLeft, repW - baseW);
      startY = -Math.min(reqTop, repH - baseH);
    } else {
      startX =
        layer.left !== undefined
          ? Math.round(layer.left)
          : layer.top !== undefined
            ? 0
            : grav.x;
      startY =
        layer.top !== undefined
          ? Math.round(layer.top)
          : layer.left !== undefined
            ? 0
            : grav.y;
    }

  return {startX,startY};
}
/** Shared legacy blend arithmetic; callers own raster traversal and storage. */
export class CompositePixel {
 readonly skipWhenSaZero:boolean;
 private readonly blend:BlendMode;
 private readonly blendId:number;
 constructor(private readonly layer:CompositeLayer) {
  const blend=this.blend=layer.blend??"over";
  this.blendId=getBlendModeId(blend);
    this.skipWhenSaZero =
      blend !== "clear" &&
      blend !== "source" &&
      blend !== "in" &&
      blend !== "out" &&
      blend !== "dest-in" &&
      blend !== "dest-atop";
 }
 apply(out:Uint8Array,dstBuf:Uint8Array,dIdx:number,ovData:Uint8Array,sIdx:number):void {
  const layer=this.layer,blend=this.blend,isOver=blend==="over",blendId=this.blendId,isSeparable=blendId>0,skipWhenSaZero=this.skipWhenSaZero,inv255=1/255;
    const saByte = ovData[sIdx + 3]!;
    if (saByte === 0 && skipWhenSaZero) return;
    if (saByte === 0 && !skipWhenSaZero) {
      out[dIdx] = 0;
      out[dIdx + 1] = 0;
      out[dIdx + 2] = 0;
      out[dIdx + 3] = 0;
      return;
    }
    if (isOver && saByte === 255) {
      out[dIdx] = ovData[sIdx]!;
      out[dIdx + 1] = ovData[sIdx + 1]!;
      out[dIdx + 2] = ovData[sIdx + 2]!;
      out[dIdx + 3] = 255;
      return;
    }
    const daByte = dstBuf[dIdx + 3]!;
    if (isOver && daByte === 255 && !layer.premultiplied) {
      const invSa = 255 - saByte;
      out[dIdx] = ((ovData[sIdx]! * saByte + out[dIdx]! * invSa) / 255) | 0;
      out[dIdx + 1] = ((ovData[sIdx + 1]! * saByte + out[dIdx + 1]! * invSa) / 255) | 0;
      out[dIdx + 2] = ((ovData[sIdx + 2]! * saByte + out[dIdx + 2]! * invSa) / 255) | 0;
      return;
    }

    const sa = saByte * inv255;
    const srP = layer.premultiplied ? ovData[sIdx]! * inv255 : (ovData[sIdx]! * inv255) * sa;
    const sgP = layer.premultiplied ? ovData[sIdx + 1]! * inv255 : (ovData[sIdx + 1]! * inv255) * sa;
    const sbP = layer.premultiplied ? ovData[sIdx + 2]! * inv255 : (ovData[sIdx + 2]! * inv255) * sa;
    const sr = layer.premultiplied ? (sa > 0 ? srP / sa : 0) : ovData[sIdx]! * inv255;
    const sg = layer.premultiplied ? (sa > 0 ? sgP / sa : 0) : ovData[sIdx + 1]! * inv255;
    const sb = layer.premultiplied ? (sa > 0 ? sbP / sa : 0) : ovData[sIdx + 2]! * inv255;

    const dr = dstBuf[dIdx]! * inv255;
    const dg = dstBuf[dIdx + 1]! * inv255;
    const db = dstBuf[dIdx + 2]! * inv255;
    const da = daByte * inv255;

    if (isSeparable) {
      const outA = sa + da * (1 - sa);
      if (outA <= 0) {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      } else {
        const drP = dr * da;
        const dgP = dg * da;
        const dbP = db * da;
        const br = blendChannelById(srP, drP, blendId);
        const bg = blendChannelById(sgP, dgP, blendId);
        const bb = blendChannelById(sbP, dbP, blendId);
        const invDa = 1 - da;
        const invSa = 1 - sa;
        const saDa = sa * da;
        const invOutA255 = 255 / outA;
        const rOut = ((invDa * srP + invSa * drP + saDa * br) * invOutA255 + 1e-5) | 0;
        const gOut = ((invDa * sgP + invSa * dgP + saDa * bg) * invOutA255 + 1e-5) | 0;
        const bOut = ((invDa * sbP + invSa * dbP + saDa * bb) * invOutA255 + 1e-5) | 0;
        out[dIdx] = rOut < 0 ? 0 : rOut > 255 ? 255 : rOut;
        out[dIdx + 1] = gOut < 0 ? 0 : gOut > 255 ? 255 : gOut;
        out[dIdx + 2] = bOut < 0 ? 0 : bOut > 255 ? 255 : bOut;
        out[dIdx + 3] = daByte === 255 ? 255 : ((outA * 255 + 1e-5) | 0);
      }
      return;
    }

    if (blend === "clear") {
      out[dIdx] = 0;
      out[dIdx + 1] = 0;
      out[dIdx + 2] = 0;
      out[dIdx + 3] = 0;
      return;
    }
    if (blend === "source") {
      if (sa > 0) {
        out[dIdx] = Math.max(0, Math.min(255, Math.floor(sr * 255 + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor(sg * 255 + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor(sb * 255 + 1e-5)));
        out[dIdx + 3] = saByte;
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "dest") return;
    if (blend === "over") {
      const outA = sa + da * (1 - sa);
      if (outA > 0) {
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((((srP + dr * da * (1 - sa) + 1e-5)) / outA) * 255)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((((sgP + dg * da * (1 - sa) + 1e-5)) / outA) * 255)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((((sbP + db * da * (1 - sa) + 1e-5)) / outA) * 255)));
        out[dIdx + 3] = Math.max(0, Math.min(255, Math.floor((outA * 255) + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "dest-over") {
      const outA = da + sa * (1 - da);
      if (outA > 0) {
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((((dr * da + srP * (1 - da) + 1e-5)) / outA) * 255)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((((dg * da + sgP * (1 - da) + 1e-5)) / outA) * 255)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((((db * da + sbP * (1 - da) + 1e-5)) / outA) * 255)));
        out[dIdx + 3] = Math.max(0, Math.min(255, Math.floor((outA * 255) + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "in") {
      const outA = sa * da;
      if (outA > 0) {
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((sr * 255) + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((sg * 255) + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((sb * 255) + 1e-5)));
        out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "out") {
      const outA = sa * (1 - da);
      if (outA > 0) {
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((sr * 255) + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((sg * 255) + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((sb * 255) + 1e-5)));
        out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "dest-in") {
      const outA = da * sa;
      if (outA > 0) {
        out[dIdx] = dstBuf[dIdx]!;
        out[dIdx + 1] = dstBuf[dIdx + 1]!;
        out[dIdx + 2] = dstBuf[dIdx + 2]!;
        out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "dest-out") {
      const outA = da * (1 - sa);
      if (outA > 0) {
        out[dIdx] = Math.floor((dr * 255) + 1e-5);
        out[dIdx + 1] = Math.floor((dg * 255) + 1e-5);
        out[dIdx + 2] = Math.floor((db * 255) + 1e-5);
        out[dIdx + 3] = Math.floor((outA + 1e-5) * 255);
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
      return;
    }
    if (blend === "atop") {
      const outA = da;
      if (outA > 0) {
        const cr = (srP + dr * da * (1 - sa)) / outA;
        const cg = (sgP + dg * da * (1 - sa)) / outA;
        const cb = (sbP + db * da * (1 - sa)) / outA;
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((cr * 255) + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((cg * 255) + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((cb * 255) + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
      }
      out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
      return;
    }
    if (blend === "dest-atop") {
      const outA = sa;
      if (outA > 0) {
        const cr = (dr * da + srP * (1 - da)) / outA;
        const cg = (dg * da + sgP * (1 - da)) / outA;
        const cb = (db * da + sbP * (1 - da)) / outA;
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((cr * 255) + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((cg * 255) + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((cb * 255) + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
      }
      out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
      return;
    }
    if (blend === "xor") {
      const outA = sa * (1 - da) + da * (1 - sa);
      if (outA > 0) {
        const cr = (srP * (1 - da) + dr * da * (1 - sa)) / outA;
        const cg = (sgP * (1 - da) + dg * da * (1 - sa)) / outA;
        const cb = (sbP * (1 - da) + db * da * (1 - sa)) / outA;
        out[dIdx] = Math.max(0, Math.min(255, Math.floor((cr * 255) + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((cg * 255) + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((cb * 255) + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
      }
      out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
      return;
    }
    if (blend === "saturate") {
      const outA = Math.min(1, sa + da);
      if (outA > 0) {
        const f = Math.min(sa, 1 - da);
        const cr = (srP * f + dr * da) / outA;
        const cg = (sgP * f + dg * da) / outA;
        const cb = (sbP * f + db * da) / outA;
        out[dIdx] = Math.max(0, Math.min(255, Math.floor(cr * 255 + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor(cg * 255 + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor(cb * 255 + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
      }
      out[dIdx + 3] = Math.floor(outA * 255 + 1e-5);
      return;
    }
    if (blend === "add") {
      const outA = Math.min(1, sa + da);
      if (outA > 0) {
        const cr = (srP + dr * da) / outA;
        const cg = (sgP + dg * da) / outA;
        const cb = (sbP + db * da) / outA;
        out[dIdx] = Math.max(0, Math.min(255, Math.floor(cr * 255 + 1e-5)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor(cg * 255 + 1e-5)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor(cb * 255 + 1e-5)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
      }
      out[dIdx + 3] = Math.floor(outA * 255 + 1e-5);
      return;
    }

    // Standard W3C separable blend over destination
    const outA = sa + da * (1 - sa);
    if (outA <= 0) {
      out[dIdx] = 0;
      out[dIdx + 1] = 0;
      out[dIdx + 2] = 0;
      out[dIdx + 3] = 0;
    } else {
      const srP = sr * sa;
      const sgP = sg * sa;
      const sbP = sb * sa;
      const drP = dr * da;
      const dgP = dg * da;
      const dbP = db * da;
      const br = blendChannelById(srP, drP, blendId);
      const bg = blendChannelById(sgP, dgP, blendId);
      const bb = blendChannelById(sbP, dbP, blendId);
      const cr = ((1 - da) * srP + (1 - sa) * drP + sa * da * br) / outA;
      const cg = ((1 - da) * sgP + (1 - sa) * dgP + sa * da * bg) / outA;
      const cb = ((1 - da) * sbP + (1 - sa) * dbP + sa * da * bb) / outA;
      out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
      out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
      out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
      out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(outA * 255)));
    }
 }
}
