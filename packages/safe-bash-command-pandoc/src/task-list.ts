import type { Inline } from "./ast-types.js";

/** Recognize only the reader's canonical, empty task marker. */
export function taskListState(node: Inline): boolean | undefined {
  if (node.t !== "Span") return undefined;
  const [attr, children] = node.c;
  if (children.length || attr[0] || attr[1].length !== 1 || attr[1][0] !== "task-list-marker" || attr[2].length !== 1 || attr[2][0]?.[0] !== "checked") return undefined;
  const value = attr[2][0][1];
  return value === "true" ? true : value === "false" ? false : undefined;
}
