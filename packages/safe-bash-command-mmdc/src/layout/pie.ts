import { MermaidBudget, type MermaidDocument, type MermaidLayoutOptions, type MermaidScene, type SceneNode, type Point } from "../contracts.js";
import { parseCssColor, resolveMermaidTheme } from "../theme.js";
import { measureLineWidth } from "../text.js";

const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7'];

export function layoutPie(document: MermaidDocument, options?: MermaidLayoutOptions): MermaidScene {
  const budget = options?.budget ?? new MermaidBudget();
  const { tokens: theme, backgroundColor } = resolveMermaidTheme(options);
  const data = document.slices!;
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const padding = options?.padding ?? theme.padding;
  const titleHeight = document.title ? 40 : 0;
  const radius = 120, cx = padding + radius, cy = padding + titleHeight + radius;
  const labels = data.map(slice => `${slice.label}${document.showData ? ` [${slice.value}]` : ''} (${(100 * (slice.value / total)).toFixed(1)}%)`);
  const legendWidth = labels.reduce((maximum, text) => Math.max(maximum, measureLineWidth(text, 13, "ui", 400)), 120) + 24;
  const width = Math.max(padding * 2 + radius * 2 + 40 + legendWidth, document.title ? measureLineWidth(document.title, 16, "ui", 600) + padding * 2 : 0);
  const height = padding * 2 + titleHeight + Math.max(radius * 2, data.length * 48);
  const nodes: SceneNode[] = [];
  let angle = -Math.PI / 2;
  const slices = data.map((slice, index) => {
    const sweep = 2 * Math.PI * (slice.value / total);
    const steps = Math.max(1, Math.ceil(sweep * radius / 2));
    budget.chargeWork(steps + 1);
    const points: Point[] = [{ x: cx, y: cy }];
    for (let step = 0; step <= steps; step++) {
      const current = angle + sweep * step / steps;
      points.push({ x: cx + radius * Math.cos(current), y: cy + radius * Math.sin(current) });
    }
    const startAngle = angle;
    angle += sweep;
    const fill = colors[index % colors.length]!;
    const y = padding + titleHeight + index * 48;
    const color = parseCssColor(fill);
    const textColor = (color.r * 0.299 + color.g * 0.587 + color.b * 0.114) / 255 > 0.55 ? "#0f172a" : "#fff";
    nodes.push({ id: `legend_${index}`, shape: 'rect', x: padding + 280, y, width: legendWidth, height: 24,
      rx: 3, fill, stroke: fill, strokeWidth: 0, shadow: false, dividers: [], badges: [],
      lines: [{ text: labels[index]!, width: measureLineWidth(labels[index]!, 13, 'ui', 400), x: padding + 292, y: y + 17, color: textColor, fontSize: 13, fontWeight: 400, fontFamily: 'ui', align: 'left' }] });
    return { points, fill, cx, cy, radius, startAngle, endAngle: angle };
  });
  if (document.title) nodes.push({ id: 'pie_title', shape: 'rect', x: padding, y: padding, width: width - 2 * padding, height: 16,
    rx: 0, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, shadow: false, dividers: [], badges: [],
    lines: [{ text: document.title, width: measureLineWidth(document.title, 16, 'ui', 600), x: width / 2, y: padding + 13, color: theme.text, fontSize: 16, fontWeight: 600, fontFamily: 'ui', align: 'center' }] });
  return { family: 'pie', direction: 'TD', width, height, viewBox: { x: 0, y: 0, width, height }, naturalBounds: { width, height },
    padding, theme, backgroundColor, title: document.title, slices, nodes, groups: [], edges: [], notes: [], lifelines: [], activations: [] };
}
