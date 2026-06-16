import type { MarkdownReaderDependencies } from "./document.js";
import { loadMarkdownDocument, sliceMarkdownBytes } from "./document.js";
import { resolveSection } from "./resolve.js";
import { UserError } from "toolcraft";
import type { TocEntry } from "./read-markdown.js";

export interface ReadSectionParams {
  file: string;
  section: string;
  includeChildren?: boolean;
}

export interface ReadSectionResult {
  file: string;
  section: TocEntry;
  markdown: string;
}

export function createReadSection(dependencies: MarkdownReaderDependencies = {}) {
  return async function readSection(params: ReadSectionParams): Promise<ReadSectionResult> {
    if (params.section.trim().length === 0) {
      throw new UserError("invalid section: expected a non-empty section id");
    }

    const { source, sections } = await loadMarkdownDocument(params.file, dependencies);
    const section = resolveSection(sections, params.section);
    const end = params.includeChildren === false ? section.bodyEndNoChildren : section.bodyEnd;

    return {
      file: params.file,
      section: {
        depth: section.depth,
        number: section.number,
        title: section.title
      },
      markdown: sliceMarkdownBytes(source, section.headingStart, end)
    };
  };
}

export const readSection = createReadSection();
