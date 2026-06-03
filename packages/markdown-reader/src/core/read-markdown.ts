import { UserError } from "toolcraft";
import type { MarkdownReaderDependencies } from "./document.js";
import { loadMarkdownDocument } from "./document.js";

export interface ReadMarkdownParams {
  file: string;
  depth?: number;
}

export interface TocEntry {
  depth: number;
  number: string | null;
  title: string;
}

export interface ReadMarkdownResult {
  file: string;
  frontmatter: Record<string, unknown>;
  sections: TocEntry[];
}

export function createReadMarkdown(dependencies: MarkdownReaderDependencies = {}) {
  return async function readMarkdown(params: ReadMarkdownParams): Promise<ReadMarkdownResult> {
    if (params.depth !== undefined && (!Number.isInteger(params.depth) || params.depth < 0)) {
      throw new UserError("invalid depth: expected a non-negative integer");
    }

    const { frontmatter, sections } = await loadMarkdownDocument(params.file, dependencies);

    return {
      file: params.file,
      frontmatter,
      sections: sections
        .filter((section) => params.depth === undefined || section.depth <= params.depth)
        .map(({ depth, number, title }) => ({ depth, number, title }))
    };
  };
}

export const readMarkdown = createReadMarkdown();
