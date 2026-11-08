import { MermaidError, type DiagramStyle } from "./contracts.js";
import { parseCssColor } from "./theme.js";

export function parseDiagramStyle(source: string): DiagramStyle {
  const result: { fill?: string; stroke?: string; color?: string; strokeWidth?: number } = {};
  let start = 0, depth = 0;
  const declarations: string[] = [];
  for (let index = 0; index <= source.length; index++) {
    if (source[index] === '(') depth++;
    if (source[index] === ')') depth--;
    if (index === source.length || source[index] === ',' && depth === 0) { declarations.push(source.slice(start, index)); start = index + 1; }
  }
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim();
    if (name === 'fill' || name === 'stroke' || name === 'color') { parseCssColor(value); result[name] = value; }
    if (name === 'stroke-width') {
      const width = Number(value.endsWith('px') ? value.slice(0, -2) : value);
      if (!Number.isFinite(width) || width < 0) throw new MermaidError('E_SYNTAX', 'Invalid stroke width');
      result.strokeWidth = width;
    }
  }
  return result;
}

export function interactionHref(source: string): string | undefined {
  let text = source.trim();
  if (text.startsWith('callback ') || text.startsWith('call ')) return undefined;
  if (text.startsWith('href ')) text = text.slice(5).trim();
  if (text[0] !== '"' && text[0] !== "'") return undefined;
  const quote = text[0];
  let end = 1;
  while (end < text.length && !(text[end] === quote && text[end - 1] !== '\\')) end++;
  if (end === text.length) throw new MermaidError('E_SYNTAX', 'Unclosed link URL');
  const href = text.slice(1, end);
  const colon = href.indexOf(':');
  if (colon >= 0 && !['https', 'http', 'mailto'].includes(href.slice(0, colon).toLowerCase())) throw new MermaidError('E_UNSUPPORTED', 'Unsupported link URL scheme');
  return href;
}
