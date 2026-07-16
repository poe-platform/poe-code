import { UserError } from "toolcraft";
import type { MarkdownReaderDependencies } from "./document.js";
import { loadMarkdownDocument } from "./document.js";
import type { Section } from "./scan.js";

export interface ReadMarkdownParams {
  file: string;
  /**
   * Limit the table of contents to <n> levels of numbered sections. Levels are
   * counted from the shallowest numbered heading, not from the raw heading
   * level, so depth 1 lists the top-level sections of a document whose body
   * starts at `##` under a single `#` title.
   */
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
        .filter((section) => isWithinDepth(section, params.depth))
        .map(({ depth, number, title }) => ({ depth, number, title }))
    };
  };
}

function isWithinDepth(section: Section, depth: number | undefined): boolean {
  if (depth === undefined) {
    return true;
  }

  return section.number !== null && section.number.split(".").length <= depth;
}

export const readMarkdown = createReadMarkdown();
