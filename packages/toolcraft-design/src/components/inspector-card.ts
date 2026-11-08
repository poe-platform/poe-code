import type { ThemePalette } from "../tokens/colors.js";
import { renderDetailCard, type DetailCardSection } from "./detail-card.js";

export interface InspectorField {
  label: string;
  value: string;
}

export interface InspectorSection {
  title?: string;
  fields: InspectorField[];
}

export interface RenderInspectorCardOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  badges?: string[];
  preview?: string;
  previewTitle?: string;
  sections?: InspectorSection[];
  width?: number;
  maxPreviewLines?: number;
}

export function renderInspectorCard(options: RenderInspectorCardOptions): string {
  const preview = truncatePreview(options.preview, options.maxPreviewLines ?? 8);
  const sections: DetailCardSection[] = (options.sections ?? [])
    .filter((section) => section.fields.length > 0)
    .map((section) => ({
      title: section.title,
      rows: section.fields.map((field) => ({ label: field.label, value: field.value }))
    }));

  return renderDetailCard({
    theme: options.theme,
    title: options.title,
    subtitle: options.subtitle,
    badges: options.badges,
    prose: preview === undefined
      ? undefined
      : [{
        title: options.previewTitle ?? "Preview",
        value: preview
      }],
    sections,
    width: options.width
  });
}

function truncatePreview(value: string | undefined, maxLines: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const lines = splitLines(value).map((line) => line.trimEnd());
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  const contentLines = firstContent === -1 ? [] : lines.slice(firstContent);
  if (contentLines.length === 0) {
    return undefined;
  }
  if (contentLines.length <= maxLines) {
    return contentLines.join("\n");
  }
  return [...contentLines.slice(0, maxLines), `... ${contentLines.length - maxLines} more line(s)`].join("\n");
}

function splitLines(content: string): string[] {
  return content.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}
