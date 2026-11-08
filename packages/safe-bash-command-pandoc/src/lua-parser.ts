import {PandocError} from "./errors.js";
import type {LuaLexer, LuaToken} from "./lua-lexer.js";
import type {LuaReference} from "./lua-storage.js";
import type {LuaSyntax} from "./lua-syntax.js";

const blockEnds = new Set(["end","else","elseif","until","eof"]);
const priorities: Readonly<Record<string, number>> = {or:1,and:2,"<":3,">":3,"<=":3,">=":3,"~=":3,"==":3,
  "|":4,"~":5,"&":6,"<<":7,">>":7,"..":8,"+":9,"-":9,"*":10,"/":10,"//":10,"%":10,"^":12};

/** Lua 5.3 grammar over backed tokens and syntax nodes. Resident recursion is
 * bounded by the existing Lua parser's 200 syntax levels. Lists and left-
 * associative expression trees grow only in caller storage. Scope checking and
 * code generation are separate; this is not selected by public compilation. */
export class LuaParser {
  private token: LuaToken = {kind:"eof",line:1};
  private lookahead: LuaToken | undefined;
  private depth = 0;
  constructor(private readonly lexer: LuaLexer, private readonly syntax: LuaSyntax) {}
  private error(message: string): never {throw new PandocError("E_AST","convert",message,undefined,`Lua line ${this.token.line}`);}
  private enter(): void {if (++this.depth > 200) this.error("too many syntax levels");}
  private async advance(): Promise<void> {
    this.token = this.lookahead ?? await this.lexer.next(); this.lookahead = undefined;
  }
  private async peek(): Promise<LuaToken> {return this.lookahead ??= await this.lexer.next();}
  private async expect(kind: string): Promise<void> {
    if (this.token.kind !== kind) this.error(`Expected '${kind}', found '${this.token.kind}'`);
    await this.advance();
  }
  private async optional(kind: string): Promise<boolean> {
    if (this.token.kind !== kind) return false;
    await this.advance(); return true;
  }
  private async name(): Promise<LuaReference> {
    const {value,line} = this.token;
    await this.expect("name");
    return this.syntax.node("name",line,{name:value});
  }
  private async names(): Promise<LuaReference> {
    const names = await this.syntax.list(this.token.line);
    do {await this.syntax.append(names,await this.name());} while (await this.optional(","));
    return names;
  }
  private async expressions(): Promise<LuaReference> {
    const values = await this.syntax.list(this.token.line);
    do {await this.syntax.append(values,await this.expression());} while (await this.optional(","));
    return values;
  }
  private async block(): Promise<LuaReference> {
    const body = await this.syntax.list(this.token.line);
    while (!blockEnds.has(this.token.kind)) {
      const statement = await this.statement();
      if (!statement) continue;
      await this.syntax.append(body,statement);
      if ((await this.syntax.describe(statement)).kind === "return") {
        if (!blockEnds.has(this.token.kind)) this.error("Unexpected statement after return");
        break;
      }
    }
    return body;
  }
  private async functionBody(line: number, method = false): Promise<LuaReference> {
    await this.expect("(");
    const parameters = await this.syntax.list(this.token.line);
    let vararg = false;
    if (this.token.kind !== ")") for (;;) {
      if (await this.optional("...")) {vararg=true; break;}
      await this.syntax.append(parameters,await this.name());
      if (!await this.optional(",")) break;
    }
    await this.expect(")");
    const body = await this.block(); await this.expect("end");
    return this.syntax.node("function",line,{parameters,vararg,method,body});
  }
  private async constructorExpression(): Promise<LuaReference> {
    const line = this.token.line; await this.expect("{");
    const fields = await this.syntax.list(line);
    while (this.token.kind !== "}") {
      const fieldLine = this.token.line;
      let key: LuaReference | undefined;
      if (await this.optional("[")) {key=await this.expression(); await this.expect("]"); await this.expect("=");}
      else if (this.token.kind === "name" && (await this.peek()).kind === "=") {
        key=await this.syntax.node("literal",this.token.line,{value:this.token.value});
        await this.advance(); await this.expect("=");
      }
      const value = await this.expression();
      await this.syntax.append(fields,await this.syntax.node("field",fieldLine,{key,value}));
      if (!await this.optional(",") && !await this.optional(";")) break;
    }
    await this.expect("}"); return this.syntax.node("table",line,{fields});
  }
  private async arguments(): Promise<LuaReference> {
    if (await this.optional("(")) {
      const args = this.token.kind === ")" ? await this.syntax.list(this.token.line) : await this.expressions();
      await this.expect(")"); return args;
    }
    const args = await this.syntax.list(this.token.line);
    if (this.token.kind === "{") await this.syntax.append(args,await this.constructorExpression());
    else if (this.token.kind === "string") {
      await this.syntax.append(args,await this.syntax.node("literal",this.token.line,{value:this.token.value}));
      await this.advance();
    } else this.error("Function arguments expected");
    return args;
  }
  private async suffix(): Promise<LuaReference> {
    const line = this.token.line;
    let value: LuaReference;
    if (this.token.kind === "name") value=await this.name();
    else if (await this.optional("(")) {
      value=await this.syntax.node("parenthesized",line,{value:await this.expression()});
      await this.expect(")");
    } else this.error("Expression expected");
    for (;;) {
      if (await this.optional(".")) {
        const {value:name,line:fieldLine}=this.token; await this.expect("name");
        value=await this.syntax.node("index",line,{base:value,key:await this.syntax.node("literal",fieldLine,{value:name})});
      } else if (await this.optional("[")) {
        const key=await this.expression(); await this.expect("]");
        value=await this.syntax.node("index",line,{base:value,key});
      } else if (await this.optional(":")) {
        const method=this.token.value; await this.expect("name");
        value=await this.syntax.node("methodcall",line,{callee:value,method,arguments:await this.arguments()});
      } else if (this.token.kind === "(" || this.token.kind === "{" || this.token.kind === "string")
        value=await this.syntax.node("call",line,{callee:value,arguments:await this.arguments()});
      else return value;
    }
  }
  private async simple(): Promise<LuaReference> {
    const {kind,line,value}=this.token;
    if (kind === "number" || kind === "string" || kind === "nil" || kind === "true" || kind === "false") {
      await this.advance();
      return this.syntax.node("literal",line,{value:kind === "nil" ? undefined : kind === "true" ? true : kind === "false" ? false : value});
    }
    if (kind === "...") {await this.advance(); return this.syntax.node("vararg",line);}
    if (kind === "function") {await this.advance(); return this.functionBody(line);}
    if (kind === "{") return this.constructorExpression();
    return this.suffix();
  }
  private async expression(minimum=0): Promise<LuaReference> {
    this.enter();
    try {
      const {kind,line}=this.token;
      let left: LuaReference;
      if (kind === "not" || kind === "-" || kind === "~" || kind === "#") {
        await this.advance(); left=await this.syntax.node("unary",line,{operand:await this.expression(11)},kind);
      } else left=await this.simple();
      for (;;) {
        const operator=this.token.kind, priority=priorities[operator] ?? 0;
        if (priority <= minimum) return left;
        const operatorLine=this.token.line; await this.advance();
        const right=await this.expression(priority-(operator === "^" || operator === ".." ? 1 : 0));
        left=await this.syntax.node("binary",operatorLine,{left,right},operator);
      }
    } finally {this.depth--;}
  }
  private async statement(): Promise<LuaReference | undefined> {
    this.enter();
    try {
      const {kind,line}=this.token;
      if (await this.optional(";")) return undefined;
      if (await this.optional("do")) {const body=await this.block(); await this.expect("end"); return this.syntax.node("do",line,{body});}
      if (await this.optional("while")) {
        const condition=await this.expression(); await this.expect("do");
        const body=await this.block(); await this.expect("end"); return this.syntax.node("while",line,{condition,body});
      }
      if (await this.optional("repeat")) {
        const body=await this.block(); await this.expect("until");
        return this.syntax.node("repeat",line,{body,condition:await this.expression()});
      }
      if (await this.optional("if")) {
        const clauses=await this.syntax.list(line);
        do {
          const clauseLine=this.token.line, condition=await this.expression(); await this.expect("then");
          await this.syntax.append(clauses,await this.syntax.node("clause",clauseLine,{condition,body:await this.block()}));
        } while (await this.optional("elseif"));
        if (await this.optional("else")) await this.syntax.append(clauses,await this.syntax.node("clause",this.token.line,{body:await this.block()}));
        await this.expect("end"); return this.syntax.node("if",line,{clauses});
      }
      if (await this.optional("for")) {
        const first=await this.name(), variables=await this.syntax.list(line); await this.syntax.append(variables,first);
        if (await this.optional("=")) {
          const start=await this.expression(); await this.expect(","); const limit=await this.expression();
          const step=await this.optional(",") ? await this.expression() : undefined;
          await this.expect("do"); const body=await this.block(); await this.expect("end");
          return this.syntax.node("fornumber",line,{variables,start,limit,step,body});
        }
        while (await this.optional(",")) await this.syntax.append(variables,await this.name());
        await this.expect("in"); const values=await this.expressions(); await this.expect("do");
        const body=await this.block(); await this.expect("end"); return this.syntax.node("forin",line,{variables,values,body});
      }
      if (await this.optional("function")) {
        let target=await this.name(), method=false;
        while (await this.optional(".")) {
          const {value:name,line:fieldLine}=this.token; await this.expect("name");
          target=await this.syntax.node("index",line,{base:target,key:await this.syntax.node("literal",fieldLine,{value:name})});
        }
        if (await this.optional(":")) {
          const {value:name,line:fieldLine}=this.token; await this.expect("name"); method=true;
          target=await this.syntax.node("index",line,{base:target,key:await this.syntax.node("literal",fieldLine,{value:name})});
        }
        return this.syntax.node("functionstatement",line,{value:target,body:await this.functionBody(line,method)});
      }
      if (await this.optional("local")) {
        if (await this.optional("function")) {
          const name=await this.name(); return this.syntax.node("localfunction",line,{name,body:await this.functionBody(line)});
        }
        const variables=await this.names(), values=await this.optional("=") ? await this.expressions() : await this.syntax.list(line);
        return this.syntax.node("local",line,{variables,values});
      }
      if (await this.optional("return")) {
        const values=blockEnds.has(this.token.kind) || this.token.kind === ";" ? await this.syntax.list(line) : await this.expressions();
        await this.optional(";"); return this.syntax.node("return",line,{values});
      }
      if (await this.optional("break")) return this.syntax.node("break",line);
      if (await this.optional("goto")) return this.syntax.node("goto",line,{name:await this.name()});
      if (await this.optional("::")) {const name=await this.name(); await this.expect("::"); return this.syntax.node("label",line,{name});}
      const first=await this.suffix();
      if (this.token.kind === "=" || this.token.kind === ",") {
        const variables=await this.syntax.list(line);
        let value=first;
        for (;;) {
          const target=(await this.syntax.describe(value)).kind;
          if (target !== "name" && target !== "index") this.error("Invalid assignment target");
          await this.syntax.append(variables,value);
          if (!await this.optional(",")) break;
          value=await this.suffix();
        }
        await this.expect("="); return this.syntax.node("assign",line,{variables,values:await this.expressions()});
      }
      const statementKind=(await this.syntax.describe(first)).kind;
      if (statementKind !== "call" && statementKind !== "methodcall") this.error(`Unexpected '${kind}' statement`);
      return first;
    } finally {this.depth--;}
  }
  async parse(): Promise<LuaReference> {
    try {
      await this.advance(); const root=await this.block();
      if (this.token.kind !== "eof") this.error(`Unexpected '${this.token.kind}'`);
      await this.lexer.close(); return root;
    } catch (error) {
      try {await this.lexer.close();} catch { /* Keep the original syntax, source or cancellation failure. */ }
      throw error;
    }
  }
}
