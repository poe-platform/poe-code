export type RegexNode = { type: "empty" }
  | { type: "begin" | "end"; multiline?: boolean; strict?: boolean; trailingNewlines?: boolean }
  | { type: "continue" | "reset" }
  | { type: "captureSet"; index: number }
  | { type: "conditional"; condition: RegexNode; yes: RegexNode; no: RegexNode }
  | { type: "boundary"; accepts: (character: string) => boolean; positive: boolean; edge?: "start" | "end" }
  | { type: "backreference"; index: number; ignoreCase?: boolean; fold?: (text: string) => string }
  | { type: "assertion"; node: RegexNode; positive: boolean; behind: boolean }
  | { type: "atomic"; node: RegexNode }
  | { type: "character"; literal?: string; accepts: (character: string) => boolean }
  | { type: "sequence" | "alternate"; nodes: RegexNode[] }
  | { type: "repeat"; node: RegexNode; minimum: number; maximum: number; lazy?: boolean }
  | { type: "group"; node: RegexNode; index: number; lastCapture: number };
