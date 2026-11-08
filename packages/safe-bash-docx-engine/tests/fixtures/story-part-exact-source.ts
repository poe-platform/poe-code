const shared = ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const;
export const storyPartSourceCases = [
  { row: 569, action: "image", owners: shared },
  { row: 570, action: "style", owners: shared },
  { row: 571, action: "style-id", owners: shared },
  { row: 572, action: "inline", owners: shared },
  { row: 573, action: "id", owners: ["document.DocumentPart"], ids: [], expected: 1 },
  { row: 574, action: "id", owners: ["document.DocumentPart"], ids: ["1"], expected: 2 },
  { row: 575, action: "id", owners: ["document.DocumentPart"], ids: ["2"], expected: 3 },
  { row: 576, action: "id", owners: ["hdrftr.HeaderPart"], ids: ["1", "2", "3"], expected: 4 },
  { row: 577, action: "id", owners: ["hdrftr.HeaderPart"], ids: ["1", "2", "4"], expected: 5 },
  { row: 578, action: "id", owners: ["hdrftr.HeaderPart"], ids: ["0", "0"], expected: 1 },
  { row: 579, action: "id", owners: ["hdrftr.FooterPart"], ids: ["0", "0", "1", "3"], expected: 4 },
  { row: 580, action: "id", owners: ["hdrftr.FooterPart"], ids: ["foo", "1", "2"], expected: 3 },
  { row: 581, action: "id", owners: ["hdrftr.FooterPart"], ids: ["1", "bar"], expected: 2 },
  { row: 582, action: "document-owner", owners: shared }
] as const;
