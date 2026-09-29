/*!
 * Anti-Grain Geometry - Version 2.3
 * Copyright (C) 2002-2005 Maxim Shemanarev (http://www.antigrain.com)
 *
 * Permission to copy, use, modify, sell and distribute this software
 * is granted provided this copyright notice appears in all copies.
 * This software is provided "as is" without express or implied
 * warranty, and with no claim as to its suitability for any purpose.
 *
 * Adapted from PDFium third_party/agg23/agg_curves.cpp, curve4_div.
 * See THIRD_PARTY_NOTICES.md for the pinned revision and adaptations.
 */

/** Flatten in device coordinates using PDFium's half-pixel flatness test. */
export function flattenCubic(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [[x1, y1]];
  const subdivide = (
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number, level: number,
  ): void => {
    if (level > 16) return;
    const abx = (ax + bx) / 2, aby = (ay + by) / 2;
    const bcx = (bx + cx) / 2, bcy = (by + cy) / 2;
    const cdx = (cx + dx) / 2, cdy = (cy + dy) / 2;
    const abcx = (abx + bcx) / 2, abcy = (aby + bcy) / 2;
    const bcdx = (bcx + cdx) / 2, bcdy = (bcy + cdy) / 2;
    const midx = (abcx + bcdx) / 2, midy = (abcy + bcdy) / 2;
    const chordX = dx - ax, chordY = dy - ay;
    const d2 = Math.abs((bx - dx) * chordY - (by - dy) * chordX);
    const d3 = Math.abs((cx - dx) * chordY - (cy - dy) * chordX);
    const significant2 = d2 > 1e-30, significant3 = d3 > 1e-30;
    if (!significant2 && !significant3) {
      if (Math.abs(ax + cx - 2 * bx) + Math.abs(ay + cy - 2 * by) +
          Math.abs(bx + dx - 2 * cx) + Math.abs(by + dy - 2 * cy) <= 4) {
        points.push([midx, midy]);
        return;
      }
    } else {
      // The upstream one-control-point and two-control-point cases share
      // this distance test; insignificant distances contribute zero.
      const distance = (significant2 ? d2 : 0) + (significant3 ? d3 : 0);
      if (distance * distance <= 0.25 * (chordX * chordX + chordY * chordY)) {
        points.push([bcx, bcy]);
        return;
      }
    }
    subdivide(ax, ay, abx, aby, abcx, abcy, midx, midy, level + 1);
    subdivide(midx, midy, bcdx, bcdy, cdx, cdy, dx, dy, level + 1);
  };
  subdivide(x1, y1, x2, y2, x3, y3, x4, y4, 0);
  points.push([x4, y4]);
  return points;
}
