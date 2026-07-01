import type { MdNode } from "./ast.js";

export interface PlaintextRenderOptions {
  announceHeadings?: boolean;
  announceCode?: boolean;
  announceAlerts?: boolean;
  showLinks?: boolean;
  expandLinks?: boolean;
  includeFrontmatter?: boolean;
}

interface PlaintextContext {
  announceHeadings: boolean;
  announceCode: boolean;
  announceAlerts: boolean;
  showLinks: boolean;
  expandLinks: boolean;
  includeFrontmatter: boolean;
  footnoteDefinitions: Map<string, string>;
  footnoteOrder: string[];
}

export function renderPlaintext(ast: MdNode, options?: PlaintextRenderOptions): string {
  void ast;
  void options;

  return "";
}

export function renderMarkdownPlaintext(
  markdown: string,
  options?: PlaintextRenderOptions
): string {
  void markdown;
  void options;

  return "";
}
