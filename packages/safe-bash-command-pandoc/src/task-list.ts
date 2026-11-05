import type { Block, Inline } from "./ast-types.js";

/** Recognize only the reader's canonical, empty task marker. */
export function taskListState(node: Inline): boolean | undefined {
  if (node.t !== "Span") return undefined;
  const [attr, children] = node.c;
  if (children.length || attr[0] || attr[1].length !== 1 || attr[1][0] !== "task-list-marker" || attr[2].length !== 1 || attr[2][0]?.[0] !== "checked") return undefined;
  const value = attr[2][0][1];
  return value === "true" ? true : value === "false" ? false : undefined;
}

/** Pandoc marks task items with a checkbox character followed by Space. */
export function taskListItemState(block: Block | undefined): boolean | undefined {
  if (block?.t !== "Plain" && block?.t !== "Para") return undefined;
  const [marker, space] = block.c;
  if (marker?.t !== "Str" || space?.t !== "Space") return undefined;
  return marker.c === "☒" ? true : marker.c === "☐" ? false : undefined;
}
