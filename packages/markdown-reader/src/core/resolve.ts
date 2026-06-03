import { UserError } from "toolcraft";
import type { Section } from "./scan.js";

export function resolveSection(sections: Section[], id: string): Section {
  const trimmedId = id.trim();
  const unnumberedTitleMatch = sections.find(
    (section) => section.number === null && section.title === trimmedId
  );

  if (unnumberedTitleMatch !== undefined) {
    return unnumberedTitleMatch;
  }

  const sectionByNumber = sections.find((section) => section.number === trimmedId);

  if (sectionByNumber !== undefined) {
    return sectionByNumber;
  }

  const titleMatches = sections.filter((section) => section.title === trimmedId);

  if (titleMatches.length === 1) {
    return titleMatches[0]!;
  }

  if (titleMatches.length > 1) {
    throw new UserError(`multiple sections match "${id}" (use numeric path e.g. 2.1)`);
  }

  throw new UserError(
    `no section matching "${id}" (try 'read-markdown' to see the table of contents)`
  );
}
