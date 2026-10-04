/** Native rotated Pango line origins, in points after rounding to display pixels at paint time. */
export function rotatedPrintLayout(options: {
  /** Override only the horizontal placement extent, as RTL Fill does after repetition. */
  horizontalWidth?: number;
  angle: number; layoutWidth?: number; widths: readonly number[]; ascent: number; lineHeight: number;
  width: number; height: number; indent: number; bordered: boolean;
  alignment: "left" | "center" | "right";
  vertical: "top" | "bottom" | "center" | "justify" | "distributed";
}, tick: () => void): {width: number; origins: {x: number; y: number}[]} {
  const units = (points: number) => Math.trunc(points / 0.75 * 1024);
  const sin = Math.sin(options.angle * Math.PI / 180), cos = Math.cos(options.angle * Math.PI / 180);
  let widest = 0;
  const widths = options.widths.map(width => {tick(); const value = units(width); widest = Math.max(widest, value); return value;});
  const alignmentWidth = options.layoutWidth === undefined ? widest : units(options.layoutWidth);
  const ascent = units(options.ascent), lineHeight = units(options.lineHeight);
  let naturalHeight = 0;
  for (const width of widths) {tick(); naturalHeight = Math.max(naturalHeight, Math.trunc(width * Math.abs(sin) + lineHeight * cos));}
  const spacing = options.vertical === "justify" && widths.length > 1 ? Math.max(0, Math.trunc((units(options.height - 1) - naturalHeight) / (widths.length - 1))) : 0;
  const measure = (spacing: number) => {
    let x0 = 0, x1 = 0, shift = 0;
    const origins = widths.map((width, index) => {
      tick();
      const lineTop = index * (lineHeight + spacing);
      const top = lineTop - (index ? Math.trunc(spacing / 2) : 0);
      const bottom = lineTop + lineHeight + (index < widths.length - 1 ? Math.trunc((spacing + 1) / 2) : 0);
      const baseline = lineTop + ascent;
      const center = (alignmentWidth - width) / 2;
      const centered = alignmentWidth % 1024 ? Math.trunc(center) : Math.floor((center + 512) / 1024) * 1024;
      const offset = options.alignment === "right" ? alignmentWidth - width : options.alignment === "center" ? centered : 0;
      const indent = offset - (sin < 0 ? widest : 0);
      if (!index && !options.bordered) shift = Math.trunc(baseline * sin - bottom / sin);
      const x = shift + Math.trunc(bottom / sin + indent * cos);
      const y = Math.trunc((baseline - bottom) * cos - indent * sin);
      x0 = Math.min(x0, x - Math.trunc((baseline - top) * sin));
      x1 = Math.max(x1, x + Math.trunc(width * cos + (bottom - baseline) * sin));
      return {x, y};
    });
    return {origins, naturalWidth: x1 - x0};
  };
  const initial = measure(0);
  const {origins, naturalWidth} = spacing ? measure(spacing) : initial;
  // Native computes horizontal placement before vertical justification remeasures.
  const horizontalWidth = options.horizontalWidth === undefined ? initial.naturalWidth : units(options.horizontalWidth);
  const width = units(options.width - 5), height = units(options.height - 1), indent = units(options.indent);
  let horizontal = options.alignment === "left" ? indent : 0;
  if (options.bordered ? sin < 0 : options.alignment === "right") horizontal += width - indent - horizontalWidth;
  else if (!options.bordered && options.alignment === "center") horizontal += Math.trunc(width / 2) + Math.trunc((-indent - horizontalWidth) / 2);
  const spare = height - naturalHeight;
  const vertical = options.vertical === "bottom" ? spare : options.vertical === "center" || options.vertical === "distributed" ? Math.trunc(spare / 2) : 0;
  return {width: initial.naturalWidth / 1024 * 0.75, origins: origins.map(({x, y}) => ({
    x: Math.floor((3 * 1024 + horizontal + x + (sin < 0 ? naturalWidth : 0) + 512) / 1024) * 0.75,
    y: Math.floor((1024 + vertical + y + naturalHeight + 512) / 1024) * 0.75
  }))};
}
