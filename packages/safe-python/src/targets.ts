import type { CollectionItem, Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";

/** Read the comma-separated assignment targets preceding a for-clause's `in`. */
export function readLoopTarget(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression): Expression {
  try {
  cursor.meter?.checkpoint(1,32);
  const items: CollectionItem[] = [];
  let comma = false;
  let end = cursor.peek().end;
  do {
    if (cursor.peek().text === "*") {
      const start = cursor.take().start;
      const value = read(cursor, 6);
      cursor.meter?.checkpoint(0,72);
      items.push({ kind: "unpack", value, start, end: value.end });
    } else {cursor.meter?.checkpoint(0,8);items.push(read(cursor, 6));}
    end = items[items.length - 1].end;
    if (cursor.peek().text !== ",") break;
    comma = true;
    end = cursor.take().end;
  } while (cursor.peek().text !== "in");
  if(comma)cursor.meter?.checkpoint(0,64);
  const target: CollectionItem = comma ? { kind: "tuple", items, start: items[0].start, end } : items[0];
  if (target.kind === "unpack") throw cursor.error("starred assignment target must be in a list or tuple");
  validateTarget(target, cursor);
  return target;
  } finally {cursor.meter?.checkpoint();}
}

export function validateTarget(target: Expression, cursor: TokenCursor, action: "assign" | "delete" = "assign"): void {
  try {
  cursor.meter?.checkpoint(1,96);
  const pending:Array<{items:readonly CollectionItem[];index:number;starred:boolean}>=[];
  const visit=(node:Expression)=>{
    cursor.meter?.checkpoint();
    if ((node.kind === "name" || node.kind === "attribute") && node.name === "__debug__") {
      throw cursor.error(action === "assign" ? "cannot assign to __debug__" : "cannot delete __debug__");
    }
    if (node.kind === "name" || node.kind === "attribute" || node.kind === "subscript") return;
    if (node.kind !== "tuple" && node.kind !== "list") throw cursor.error(action === "assign" ? "cannot assign to expression" : "cannot delete expression");
    cursor.meter?.checkpoint(0,72);pending.push({items:node.items,index:0,starred:false});
  };
  visit(target);
  while(pending.length){
    cursor.meter?.checkpoint();
    const frame=pending[pending.length-1];
    if(frame.index===frame.items.length){pending.pop();continue;}
    const item=frame.items[frame.index++];
    if (item.kind === "unpack") {
      if (action === "delete") throw cursor.error("cannot delete starred expression");
      if (frame.starred) throw cursor.error("multiple starred expressions in assignment");
      frame.starred = true;
      visit(item.value);
    } else visit(item);
  }
  } finally {cursor.meter?.checkpoint();}
}
