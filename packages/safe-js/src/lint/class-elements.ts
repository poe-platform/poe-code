import type { BlockStatement, ClassNode, Expression } from "../parse.js";

/** Visit both definition-time expressions and deferred element bodies. */
export function visitClassElements(
  node: ClassNode,
  expression: (node: Expression) => void,
  statement: (node: BlockStatement) => void
): void {
  if (node.superClass !== undefined) expression(node.superClass);
  for (const element of node.body.body) {
    if (element.type === "StaticBlock") {
      statement(element.body);
      continue;
    }
    if (element.computed) expression(element.key);
    if (element.value !== undefined) expression(element.value);
  }
}

/** Await in a computed key belongs to the defining function, unlike methods. */
export function classDefinitionContains(
  node: ClassNode,
  expression: (node: Expression) => boolean
): boolean {
  return (node.superClass !== undefined && expression(node.superClass)) ||
    node.body.body.some(element => element.type !== "StaticBlock" && element.computed && expression(element.key));
}
