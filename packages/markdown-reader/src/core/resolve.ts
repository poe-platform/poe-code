import { UserError } from "toolcraft";
import type { Section } from "./scan.js";

export function resolveSection(sections: Section[], id: string): Section {
  const trimmedId = id.trim();
  if (trimmedId.length === 0) {
    throw new UserError("invalid section: expected a non-empty section id");
  }

  const sectionByNumber = sections.find((section) => section.number === trimmedId);

  if (sectionByNumber !== undefined) {
    return sectionByNumber;
  }

  const unnumberedTitleMatch = sections.find(
    (section) => section.number === null && section.title === trimmedId
  );

  if (unnumberedTitleMatch !== undefined) {
    return unnumberedTitleMatch;
  }

  const titleMatches = sections.filter((section) => section.title === trimmedId);

  if (titleMatches.length === 1) {
    return titleMatches[0]!;
  }

  if (titleMatches.length > 1) {
    throw new UserError(`multiple sections match "${id}" (use numeric path e.g. 2.1)`);
  }

  throw new UserError(
    `no section matching "${id}" (try 'poe-code plan markdown-read' to see the table of contents)`
  );
}
