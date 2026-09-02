import { UserError } from "toolcraft";
import { describe, expect, it } from "vitest";
import type { Section } from "./scan.js";
import { resolveSection } from "./resolve.js";

const sections: Section[] = [
  {
    depth: 1,
    title: "Markdown Reader",
    number: null,
    headingStart: 0,
    bodyStart: 17,
    bodyEnd: 17,
    bodyEndNoChildren: 17
  },
  {
    depth: 2,
    title: "Overview",
    number: "1",
    headingStart: 17,
    bodyStart: 30,
    bodyEnd: 45,
    bodyEndNoChildren: 45
  },
  {
    depth: 2,
    title: "Repeated",
    number: "2",
    headingStart: 45,
    bodyStart: 58,
    bodyEnd: 72,
    bodyEndNoChildren: 72
  },
  {
    depth: 3,
    title: "Repeated",
    number: "2.1",
    headingStart: 72,
    bodyStart: 87,
    bodyEnd: 103,
    bodyEndNoChildren: 103
  }
];

describe("resolveSection", () => {
  it("rejects empty and whitespace-only section ids", () => {
    for (const id of ["", " \t\n"]) {
      expect(() => resolveSection(sections, id)).toThrowError(UserError);
      expect(() => resolveSection(sections, id)).toThrowError(
        "invalid section: expected a non-empty section id"
      );
    }
  });

  it("resolves by number and by title on the same section", () => {
    const byNumber = resolveSection(sections, "1");
    const byTitle = resolveSection(sections, "  Overview  ");

    expect(byNumber).toBe(sections[1]);
    expect(byTitle).toBe(sections[1]);
  });

  it("prefers a numbered path over a numbered title", () => {
    const section = resolveSection(
      [
        {
          depth: 2,
          title: "Numeric winner",
          number: "2.1",
          headingStart: 0,
          bodyStart: 0,
          bodyEnd: 0,
          bodyEndNoChildren: 0
        },
        {
          depth: 2,
          title: "2.1",
          number: "3",
          headingStart: 0,
          bodyStart: 0,
          bodyEnd: 0,
          bodyEndNoChildren: 0
        }
      ],
      "2.1"
    );

    expect(section.title).toBe("Numeric winner");
  });

  it("prefers numbered section paths over unnumbered numeric titles", () => {
    const section = resolveSection(
      [
        {
          depth: 1,
          title: "1",
          number: null,
          headingStart: 0,
          bodyStart: 0,
          bodyEnd: 0,
          bodyEndNoChildren: 0
        },
        {
          depth: 2,
          title: "Actual Section",
          number: "1",
          headingStart: 0,
          bodyStart: 0,
          bodyEnd: 0,
          bodyEndNoChildren: 0
        }
      ],
      "1"
    );

    expect(section.title).toBe("Actual Section");
  });

  it("trims numeric paths without doing fuzzy title matching", () => {
    expect(resolveSection(sections, " 1 ")).toBe(sections[1]);

    expect(() => resolveSection(sections, "overview")).toThrowError(
      new UserError(
        'no section matching "overview" (try \'poe-code plan markdown-read\' to see the table of contents)'
      )
    );
  });

  it("throws a UserError naming the missing id and a real recovery command", () => {
    expect(() => resolveSection(sections, "missing")).toThrowError(
      new UserError(
        'no section matching "missing" (try \'poe-code plan markdown-read\' to see the table of contents)'
      )
    );
  });

  it("throws a UserError when the title is ambiguous", () => {
    expect(() => resolveSection(sections, "Repeated")).toThrowError(
      new UserError('multiple sections match "Repeated" (use numeric path e.g. 2.1)')
    );
  });
});
