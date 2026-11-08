/** GOffice 0.10.61 go-geometry.c centered rectangles; angles in radians.
 * Font shaping/measurement is a separate explicit host capability.
 */
export interface OrientedRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
}
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type LabelAnchor = "top-bottom" | "left-right";

/** go_geometry_calc_label_position, relative to an axis tick at the origin. */
export function positionLabel(box: OrientedRectangle, axisAngle: number, offset: number,
  side: "left" | "right", anchor?: LabelAnchor): { readonly box: OrientedRectangle; readonly anchor: LabelAnchor } {
  if (side === "right") axisAngle += Math.PI;
  const s = Math.sin(box.angle - axisAngle), c = Math.cos(box.angle - axisAngle);
  const dt = Math.abs(box.width * s / 2), ds = Math.abs(box.height * c / 2);
  const resolved = anchor ?? (dt < ds ? "top-bottom" : "left-right");
  let x: number, y: number;
  if (resolved === "top-bottom") {
    offset += dt;
    x = box.height * Math.sin(box.angle) / 2;
    y = -box.height * Math.cos(box.angle) / 2;
    if (c < 0) { x = -x; y = -y; }
  } else {
    offset += ds;
    x = -box.width * Math.cos(box.angle) / 2;
    y = -box.width * Math.sin(box.angle) / 2;
    if (s < 0) { x = -x; y = -y; }
  }
  x += offset * Math.sin(axisAngle);
  y += offset * -Math.cos(axisAngle);
  return { box: { ...box, x, y }, anchor: resolved };
}

export function orientedBounds(box: OrientedRectangle): Rectangle {
  const c = Math.cos(box.angle), s = Math.sin(box.angle);
  const width = Math.abs(box.width * c) + Math.abs(box.height * s);
  const height = Math.abs(box.width * s) + Math.abs(box.height * c);
  return { x: box.x - width / 2, y: box.y - height / 2, width, height };
}

export function rectanglesOverlap(first: OrientedRectangle, second: OrientedRectangle): boolean {
  const c = Math.abs(Math.cos(second.angle - first.angle));
  const s = Math.abs(Math.sin(second.angle - first.angle));
  const dx = second.x - first.x, dy = second.y - first.y;
  // Keep the native polar evaluation order, including boundary roundoff.
  const distance = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
  const a00 = Math.abs(first.width / 2), a01 = Math.abs(first.height / 2);
  const a10 = Math.abs(second.width / 2), a11 = Math.abs(second.height / 2);
  if (Math.abs(distance * Math.cos(angle - first.angle)) > a00 + (a10 * c + a11 * s)) return false;
  if (Math.abs(distance * Math.sin(angle - first.angle)) > a01 + (a10 * s + a11 * c)) return false;
  if (Math.abs(distance * Math.cos(second.angle - angle)) > a00 * c + a01 * s + a10) return false;
  if (Math.abs(distance * Math.sin(second.angle - angle)) > a00 * s + a01 * c + a11) return false;
  return true;
}
