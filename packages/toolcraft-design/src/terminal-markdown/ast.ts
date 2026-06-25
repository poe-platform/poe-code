export type MdRange = {
  start: number;
  end: number;
};

export type CodeTokenKind =
  | "anchor"
  | "at-rule"
  | "attribute"
  | "boolean"
  | "color"
  | "command"
  | "comment"
  | "decorator"
  | "directive"
  | "flag"
  | "function"
  | "identifier"
  | "important"
  | "invalid"
  | "key"
  | "keyword"
  | "label"
  | "null"
  | "number"
  | "operator"
  | "parameter"
  | "plain"
  | "property"
  | "punctuation"
  | "regex"
  | "selector"
  | "string"
  | "tag"
  | "template"
  | "type"
  | "variable";

export type CodeToken = {
  kind: CodeTokenKind;
  value: string;
};

type MdNodeWithRange = {
  range?: MdRange;
};

export type MdNode = MdNodeWithRange &
  (
    | { type: "root"; children: MdNode[] }
    | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MdNode[] }
    | { type: "paragraph"; children: MdNode[] }
    | { type: "blockquote"; children: MdNode[] }
    | { type: "code"; lang?: string; meta?: string; value: string; tokens?: CodeToken[] }
    | { type: "list"; ordered: boolean; start?: number; children: MdNode[] }
    | { type: "listItem"; checked?: boolean; children: MdNode[] }
    | { type: "thematicBreak" }
    | {
        type: "table";
        align: Array<"left" | "center" | "right" | null>;
        children: MdNode[];
      }
    | { type: "tableRow"; children: MdNode[] }
    | { type: "tableCell"; children: MdNode[] }
    | { type: "html"; value: string }
    | { type: "text"; value: string }
    | { type: "emphasis"; children: MdNode[] }
    | { type: "strong"; children: MdNode[] }
    | { type: "strikethrough"; children: MdNode[] }
    | { type: "inlineCode"; value: string }
    | { type: "link"; url: string; title?: string; children: MdNode[] }
    | { type: "image"; url: string; alt: string; title?: string }
    | { type: "break" }
    | { type: "frontmatter"; data: Record<string, unknown> }
    // GFM extensions
    | {
        type: "alert";
        kind: "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";
        children: MdNode[];
      }
    | { type: "footnoteDefinition"; label: string; children: MdNode[] }
    | { type: "footnoteReference"; label: string }
  );
