import { UserError } from "toolcraft";
import type { Section } from "./scan.js";

export function resolveSection(sections: Section[], id: string): Section {
  const sectionByNumber = sections.find((section) => section.number === id);

  if (sectionByNumber !== undefined) {
    return sectionByNumber;
  }

  const trimmedId = id.trim();
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
