import type {SvgMatrix} from "./svg-renderer.js";
export const multiplySvgMatrices = (m1: SvgMatrix, m2: SvgMatrix): SvgMatrix => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];

export function applySvgTransform(cur:SvgMatrix,kind:string,args:readonly number[]):SvgMatrix {
      if (kind === "translate") {
        const tx = args[0] ?? 0;
        const ty = args[1] ?? 0;
        cur = multiplySvgMatrices(cur, [1, 0, 0, 1, tx, ty]);
      } else if (kind === "scale") {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        cur = multiplySvgMatrices(cur, [sx, 0, 0, sy, 0, 0]);
      } else if (kind === "rotate") {
        const rad = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        if (cx !== 0 || cy !== 0) {
          cur = multiplySvgMatrices(cur, [1, 0, 0, 1, cx, cy]);
          cur = multiplySvgMatrices(cur, [cos, sin, -sin, cos, 0, 0]);
          cur = multiplySvgMatrices(cur, [1, 0, 0, 1, -cx, -cy]);
        } else {
          cur = multiplySvgMatrices(cur, [cos, sin, -sin, cos, 0, 0]);
        }
      } else if (kind === "matrix" && args.length >= 6) {
        cur = multiplySvgMatrices(cur, [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]);
      }
return cur;
}
