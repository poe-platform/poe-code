import type {
  MermaidBudget,
  MermaidScene,
  SceneLabelPill,
  SceneMarker,
  SceneNode,
  SceneTextLine
} from "./contracts.js";

const encoder = new TextEncoder();

export function escapeXml(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else out += ch;
  }
  return out;
}

function renderTextLine(line: SceneTextLine, themeFontFamily: string, monoFontFamily: string): string {
  if (!line.text) return "";
  const anchor =
    line.align === "center" ? "middle" : line.align === "right" ? "end" : "start";
  const family = line.fontFamily === "mono" ? monoFontFamily : themeFontFamily;
  return `<text x="${line.x}" y="${line.y}" fill="${escapeXml(line.color)}" font-family="${escapeXml(family)}" font-size="${line.fontSize}" font-weight="${line.fontWeight}" letter-spacing="0.025em" text-anchor="${anchor}">${escapeXml(line.text)}</text>`;
}

function buildRoundedDiamondPath(x: number, y: number, w: number, h: number, r = 4): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const top = { x: cx, y };
  const right = { x: x + w, y: cy };
  const bottom = { x: cx, y: y + h };
  const left = { x, y: cy };

  const dx = w / 2;
  const dy = h / 2;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const cr = Math.min(r, len * 0.25);

  const p = (pt: { x: number; y: number }, ox: number, oy: number) =>
    `${Math.round((pt.x + ox) * 100) / 100} ${Math.round((pt.y + oy) * 100) / 100}`;

  return [
    `M ${p(top, ux * cr, uy * cr)}`,
    `L ${p(right, -ux * cr, -uy * cr)}`,
    `Q ${right.x} ${right.y} ${p(right, -ux * cr, uy * cr)}`,
    `L ${p(bottom, ux * cr, -uy * cr)}`,
    `Q ${bottom.x} ${bottom.y} ${p(bottom, -ux * cr, -uy * cr)}`,
    `L ${p(left, ux * cr, uy * cr)}`,
    `Q ${left.x} ${left.y} ${p(left, ux * cr, -uy * cr)}`,
    `L ${p(top, -ux * cr, uy * cr)}`,
    `Q ${top.x} ${top.y} ${p(top, ux * cr, uy * cr)}`,
    "Z"
  ].join(" ");
}

function renderMarker(marker: SceneMarker | undefined): string {
  if (!marker || marker.kind === "none") return "";
  const deg = Math.round(((marker.angleRadians * 180) / Math.PI) * 100) / 100;
  const tx = marker.tip.x;
  const ty = marker.tip.y;
  const transform = `translate(${tx}, ${ty}) rotate(${deg})`;

  switch (marker.kind) {
    case "arrow":
      // Sleek swept-back concave dart (length=9, width=7, inner notch=2.2):
      // Local coordinates placed so tip (9, 3.5) is at origin (0, 0): translate(-9, -3.5)
      return `<g transform="${transform}"><path d="M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z" transform="translate(-9, -3.5)" fill="${escapeXml(marker.fill)}" stroke="${escapeXml(marker.stroke)}" stroke-width="1" stroke-linejoin="round"/></g>`;
    case "openArrow":
      return `<g transform="${transform}"><path d="M -8 -3.5 L 0 0 L -8 3.5" fill="none" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    case "cross":
      return `<g transform="${transform}"><path d="M -9 -4 L -1 4 M -9 4 L -1 -4" fill="none" stroke="${escapeXml(marker.stroke)}" stroke-width="1.75" stroke-linecap="round"/></g>`;
    case "umlHollowTriangle":
      return `<g transform="${transform}"><polygon points="-10,-4 0,0 -10,4" fill="${escapeXml(marker.fill)}" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5" stroke-linejoin="round"/></g>`;
    case "umlComposition":
      return `<g transform="${transform}"><polygon points="-12,0 -6,-3.5 0,0 -6,3.5" fill="${escapeXml(marker.stroke)}" stroke="${escapeXml(marker.stroke)}" stroke-width="1.4" stroke-linejoin="round"/></g>`;
    case "umlAggregation":
      return `<g transform="${transform}"><polygon points="-12,0 -6,-3.5 0,0 -6,3.5" fill="${escapeXml(marker.fill)}" stroke="${escapeXml(marker.stroke)}" stroke-width="1.4" stroke-linejoin="round"/></g>`;
    case "erExactlyOne":
      return `<g transform="${transform}"><path d="M -5 -4.5 L -5 4.5 M -9 -4.5 L -9 4.5" fill="none" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5" stroke-linecap="round"/></g>`;
    case "erZeroOrOne":
      return `<g transform="${transform}"><path d="M -4 -4.5 L -4 4.5" fill="none" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5" stroke-linecap="round"/><circle cx="-10" cy="0" r="3.2" fill="${escapeXml(marker.fill)}" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5"/></g>`;
    case "erOneOrMore":
      return `<g transform="${transform}"><path d="M -9 -4.5 L -9 4.5 M -9 0 L 0 -4.5 M -9 0 L 0 4.5" fill="none" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    case "erZeroOrMore":
      return `<g transform="${transform}"><path d="M -8 0 L 0 -4.5 M -8 0 L 0 4.5" fill="none" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="-12" cy="0" r="3.2" fill="${escapeXml(marker.fill)}" stroke="${escapeXml(marker.stroke)}" stroke-width="1.5"/></g>`;
  }
}

function renderPill(
  pill: SceneLabelPill,
  fontFamily: string,
  monoFontFamily: string
): string {
  const linesSvg = pill.lines
    .map((l) => renderTextLine(l, fontFamily, monoFontFamily))
    .join("");
  return `<g class="mmdc-label-pill"><rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" rx="${pill.rx}" fill="${escapeXml(pill.fill)}" stroke="${escapeXml(pill.stroke)}" stroke-width="1"/>${linesSvg}</g>`;
}

function renderNode(
  node: SceneNode,
  fontFamily: string,
  monoFontFamily: string,
  index: number
): string {
  const filterAttr = node.shadow ? ` filter="url(#mmdc-shadow)"` : "";
  if (node.shape === "stateStart") {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const r = Math.min(node.width, node.height) / 2 - 2;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="1.5"/>`;
  }
  if (node.shape === "stateEnd") {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const rOuter = Math.min(node.width, node.height) / 2 - 1;
    const rInner = Math.max(4, rOuter - 5);
    return `<g><circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="${rInner}" fill="${escapeXml(node.stroke)}"/></g>`;
  }

  let shapeSvg: string;
  if (node.shape === "diamond") {
    const d = buildRoundedDiamondPath(node.x, node.y, node.width, node.height, 4);
    shapeSvg = `<path d="${d}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}"${filterAttr}/>`;
  } else if (node.shape === "circle") {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const r = Math.min(node.width, node.height) / 2;
    shapeSvg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}"${filterAttr}/>`;
  } else if (node.headerFill && node.headerHeight) {
    const clipId = `mmdc-node-clip-${index}`;
    shapeSvg =
      `<defs><clipPath id="${clipId}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.rx}"/></clipPath></defs>` +
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.rx}" fill="${escapeXml(node.fill)}"${filterAttr}/>` +
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.headerHeight}" fill="${escapeXml(node.headerFill)}" clip-path="url(#${clipId})"/>` +
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.rx}" fill="none" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}"/>`;
  } else {
    shapeSvg = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.rx}" fill="${escapeXml(node.fill)}" stroke="${escapeXml(node.stroke)}" stroke-width="${node.strokeWidth}"${filterAttr}/>`;
  }

  const dividersSvg = node.dividers
    .map(
      (d) =>
        `<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="${escapeXml(d.stroke)}" stroke-width="1"/>`
    )
    .join("");

  const badgesSvg = node.badges
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.rx}" fill="${escapeXml(b.fill)}" stroke="${escapeXml(b.stroke)}" stroke-width="1"/>` +
        renderTextLine(b.text, fontFamily, monoFontFamily)
    )
    .join("");

  const linesSvg = node.lines
    .map((l) => renderTextLine(l, fontFamily, monoFontFamily))
    .join("");

  return `<g class="mmdc-node" data-id="${escapeXml(node.id)}">${shapeSvg}${dividersSvg}${badgesSvg}${linesSvg}</g>`;
}

export function serializeSceneToSvg(
  scene: MermaidScene,
  budget?: MermaidBudget
): string {
  const { theme } = scene;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="${scene.viewBox.x} ${scene.viewBox.y} ${scene.viewBox.width} ${scene.viewBox.height}" role="img">`
  );

  if (scene.title) {
    parts.push(`<title>${escapeXml(scene.title)}</title>`);
  }
  if (scene.description) {
    parts.push(`<desc>${escapeXml(scene.description)}</desc>`);
  }

  parts.push(
    `<defs>` +
      `<filter id="mmdc-shadow" x="-12%" y="-12%" width="124%" height="132%">` +
      `<feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="${escapeXml(theme.shadowColor)}"/>` +
      `</filter>` +
      `<marker id="mmdc-dart" viewBox="0 0 9 7" refX="9" refY="3.5" markerWidth="9" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z" fill="${escapeXml(theme.edge)}" stroke-linejoin="round"/>` +
      `</marker>` +
      `</defs>`
  );

  if (scene.backgroundColor.toLowerCase() !== "transparent") {
    parts.push(
      `<rect width="${scene.viewBox.width}" height="${scene.viewBox.height}" fill="${escapeXml(scene.backgroundColor)}"/>`
    );
  }

  // Lifelines
  for (const life of scene.lifelines) {
    parts.push(
      `<line x1="${life.x}" y1="${life.y1}" x2="${life.x}" y2="${life.y2}" stroke="${escapeXml(life.stroke)}" stroke-width="1.25" stroke-dasharray="5 5"/>`
    );
  }

  // Groups
  scene.groups.forEach((group, idx) => {
    const clipId = `mmdc-group-clip-${idx}`;
    const dashAttr = group.dashed ? ` stroke-dasharray="6 4"` : "";
    parts.push(
      `<g class="mmdc-group" data-id="${escapeXml(group.id)}">` +
        `<defs><clipPath id="${clipId}"><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${group.rx}"/></clipPath></defs>` +
        `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${group.rx}" fill="${escapeXml(group.fill)}"/>` +
        `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.headerHeight}" fill="${escapeXml(group.headerFill)}" clip-path="url(#${clipId})"/>` +
        `<line x1="${group.x}" y1="${group.y + group.headerHeight}" x2="${group.x + group.width}" y2="${group.y + group.headerHeight}" stroke="${escapeXml(group.stroke)}" stroke-width="1"/>` +
        `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${group.rx}" fill="none" stroke="${escapeXml(group.stroke)}" stroke-width="${group.strokeWidth}"${dashAttr}/>` +
        renderTextLine(group.label, theme.fontFamily, theme.monospaceFontFamily)
    );
    if (group.sectionDividers) {
      for (const div of group.sectionDividers) {
        parts.push(
          `<line x1="${group.x}" y1="${div.y}" x2="${group.x + group.width}" y2="${div.y}" stroke="${escapeXml(group.stroke)}" stroke-width="1" stroke-dasharray="5 4"/>`
        );
        if (div.label) {
          const padX = 6;
          const pillW = Math.ceil(div.label.width + padX * 2);
          parts.push(`<rect x="${div.label.x - padX}" y="${div.y + 3}" width="${pillW}" height="17" rx="4" fill="${escapeXml(theme.surface)}" stroke="${escapeXml(theme.border)}" stroke-width="0.75"/>`);
          parts.push(renderTextLine(div.label, theme.fontFamily, theme.monospaceFontFamily));
        }
      }
    }
    parts.push(`</g>`);
  });

  // Activations
  for (const act of scene.activations) {
    parts.push(
      `<rect x="${act.x}" y="${act.y}" width="${act.width}" height="${act.height}" rx="2" fill="${escapeXml(act.fill)}" stroke="${escapeXml(act.stroke)}" stroke-width="1.25"/>`
    );
  }

  // Edges (strokes + arrowheads)
  for (const edge of scene.edges) {
    const dash = edge.lineStyle === "dotted" ? ` stroke-dasharray="5 4"` : "";
    parts.push(
      `<g class="mmdc-edge" data-id="${escapeXml(edge.id)}">` +
        `<path d="${edge.d}" fill="none" stroke="${escapeXml(edge.stroke)}" stroke-width="${edge.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash}/>` +
        renderMarker(edge.startMarker) +
        renderMarker(edge.endMarker) +
        `</g>`
    );
  }

  // Nodes
  scene.nodes.forEach((node, idx) => {
    parts.push(renderNode(node, theme.fontFamily, theme.monospaceFontFamily, idx));
  });

  // Edge label pills on top of edges & nodes
  for (const edge of scene.edges) {
    if (edge.labelPill) {
      parts.push(renderPill(edge.labelPill, theme.fontFamily, theme.monospaceFontFamily));
    }
    if (edge.sourceLabelPill) {
      parts.push(renderPill(edge.sourceLabelPill, theme.fontFamily, theme.monospaceFontFamily));
    }
    if (edge.targetLabelPill) {
      parts.push(renderPill(edge.targetLabelPill, theme.fontFamily, theme.monospaceFontFamily));
    }
  }

  // Notes
  for (const note of scene.notes) {
    const filterAttr = note.shadow ? ` filter="url(#mmdc-shadow)"` : "";
    const linesSvg = note.lines
      .map((l) => renderTextLine(l, theme.fontFamily, theme.monospaceFontFamily))
      .join("");
    parts.push(
      `<g class="mmdc-note" data-id="${escapeXml(note.id)}">` +
        `<rect x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" rx="${note.rx}" fill="${escapeXml(note.fill)}" stroke="${escapeXml(note.stroke)}" stroke-width="1.25"${filterAttr}/>` +
        linesSvg +
        `</g>`
    );
  }

  parts.push(`</svg>`);
  const svg = parts.join("\n");
  budget?.chargeOutputBytes(encoder.encode(svg).byteLength);
  return svg;
}
