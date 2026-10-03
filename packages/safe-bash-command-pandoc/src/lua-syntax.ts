import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const kinds = ["list","literal","name","vararg","unary","binary","index","call","methodcall","table","field","function","parenthesized",
  "assign","local","localfunction","functionstatement","do","while","repeat","if","clause","fornumber","forin","return","break","goto","label"] as const;
const fields = ["name","value","left","right","operand","base","key","callee","arguments","method","fields","parameters","vararg","body",
  "condition","clauses","variables","values","start","limit","step","length","operator"] as const;
const operators = ["or","and","<",">","<=",">=","~=","==","|","~","&","<<",">>","..","+","-","*","/","//","%","^","not","#"];
export type LuaSyntaxKind = typeof kinds[number];
export type LuaSyntaxField = typeof fields[number];

/** Syntax nodes and variable-length lists in caller storage. Only a node's
 * fixed set of fields or one list item needs to be resident at a time. */
export class LuaSyntax {
  constructor(private readonly heap: LuaStorage) {}
  async node(kind: LuaSyntaxKind, line: number, values: Partial<Record<LuaSyntaxField, StoredLuaValue>> = {}, operator?: string): Promise<LuaReference> {
    const node = await this.heap.table();
    await this.heap.set(node,-1,kinds.indexOf(kind));
    await this.heap.set(node,-2,line);
    for (const [name,value] of Object.entries(values)) await this.heap.set(node,fields.indexOf(name as LuaSyntaxField),value);
    if (operator !== undefined) {
      const code = operators.indexOf(operator);
      if (code < 0) throw new TypeError("Unknown Lua operator");
      await this.heap.set(node,fields.indexOf("operator"),code);
    }
    return node;
  }
  async describe(node: LuaReference): Promise<{kind: LuaSyntaxKind; line: number}> {
    const kind = kinds[await this.heap.get(node,-1) as number];
    if (!kind) throw new TypeError("Expected Lua syntax node");
    return {kind,line:await this.heap.get(node,-2) as number};
  }
  async get(node: LuaReference, field: LuaSyntaxField): Promise<StoredLuaValue> {
    return this.heap.get(node,fields.indexOf(field));
  }
  async operator(node: LuaReference): Promise<string | undefined> {
    const code = await this.get(node,"operator");
    return code === undefined ? undefined : operators[code as number];
  }
  async list(line: number): Promise<LuaReference> {return this.node("list",line,{length:0});}
  async length(list: LuaReference): Promise<number> {return await this.get(list,"length") as number;}
  async append(list: LuaReference, value: StoredLuaValue): Promise<void> {
    const length = await this.length(list);
    await this.heap.set(list,fields.length+length,value);
    await this.heap.set(list,fields.indexOf("length"),length+1);
  }
  async at(list: LuaReference, index: number): Promise<StoredLuaValue> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= await this.length(list)) throw new RangeError("Invalid Lua syntax list index");
    return this.heap.get(list,fields.length+index);
  }
}
