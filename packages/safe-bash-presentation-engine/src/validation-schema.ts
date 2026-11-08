export const rules = [
  "main-part",
  "content-types",
  "relationship-targets",
  "required-structure",
  "slide-ids",
  "shape-ids",
  "master-layouts",
  "note-associations",
  "timing-references",
  "connector-references"
] as const;
export type Rule = (typeof rules)[number];
export const dialects = [
  {
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  },
  {
    p: "http://purl.oclc.org/ooxml/presentationml/main",
    a: "http://purl.oclc.org/ooxml/drawingml/main",
    r: "http://purl.oclc.org/ooxml/officeDocument/relationships"
  }
];
export const types = new Map(
  [
    ["presentation.main", "presentation"],
    ["template.main", "presentation"],
    ["slideshow.main", "presentation"],
    ["slide", "sld"],
    ["slideMaster", "sldMaster"],
    ["slideLayout", "sldLayout"],
    ["notesSlide", "notes"],
    ["notesMaster", "notesMaster"],
    ["handoutMaster", "handoutMaster"]
  ].map(([type, root]) => [
    `application/vnd.openxmlformats-officedocument.presentationml.${type}+xml`.toLowerCase(),
    root!
  ])
);
