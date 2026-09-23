import type { AwkProgram, Expression, Statement } from "./awk-syntax.js";
import { Budget, ProgramError } from "./shared.js";
import { quoteAwk } from "./awk-quote.js";

export function prettyAwk(program: AwkProgram, budget: Budget): string {
  let output = "";
  const emit = (part: string) => {
    budget.step(part.length + 1);
    if (output.length + part.length > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    output += part;
  };
  const expression = (node: Expression): void => {
    switch (node.kind) {
      case "number": emit(String(node.value)); return;
      case "string": emit(quoteAwk(node.value, budget)); return;
      case "regex": {
        emit("/");
        for (const character of node.source ?? "") emit(character === "/" ? "\\/" : character);
        emit("/"); return;
      }
      case "variable": emit(node.name); return;
      case "field": emit("$"); expression(node.index); return;
      case "array": emit(`${node.name}[`); list(node.indexes); emit("]"); return;
      case "tuple": emit("("); list(node.items); emit(")"); return;
      case "unary": emit("("); if (!node.postfix) emit(node.operator); expression(node.operand); if (node.postfix) emit(node.operator); emit(")"); return;
      case "binary": emit("("); expression(node.left); emit(` ${node.operator} `); expression(node.right); emit(")"); return;
      case "conditional": emit("("); expression(node.condition); emit(" ? "); expression(node.yes); emit(" : "); expression(node.no); emit(")"); return;
      case "getline": emit("(getline "); if (node.target) { expression(node.target); emit(" "); } emit("< "); expression(node.file); emit(")"); return;
      case "call": emit(`${node.name}(`); list(node.args); emit(")"); return;
    }
  };
  const list = (items: readonly Expression[]): void => { items.forEach((item, index) => { if (index) emit(", "); expression(item); }); };
  const controlled = (node: Statement, depth: number): void => {
    emit(`${"\t".repeat(depth)}{\n`);
    statement(node, depth + 1);
    emit(`${"\t".repeat(depth)}}\n`);
  };
  const statement = (node: Statement, depth: number): void => {
    const indent = "\t".repeat(depth);
    emit(indent);
    switch (node.kind) {
      case "block": emit("{\n"); for (const child of node.body) statement(child, depth + 1); emit(`${indent}}\n`); return;
      case "expression": expression(node.expression); break;
      case "print": emit(node.formatted ? "printf " : "print "); list(node.args); if (node.redirect) { emit(node.redirect.append ? " >> " : " > "); expression(node.redirect.destination); } break;
      case "flow": emit(node.flow); if (node.value) { emit(" "); expression(node.value); } break;
      case "delete": emit("delete "); expression(node.target); break;
      case "if": emit("if ("); expression(node.condition); emit(")\n"); controlled(node.yes, depth); if (node.no) { emit(`${indent}else\n`); controlled(node.no, depth); } return;
      case "while": emit("while ("); expression(node.condition); emit(")\n"); controlled(node.body, depth); return;
      case "do": emit("do\n"); controlled(node.body, depth); emit(`${indent}while (`); expression(node.condition); emit(")\n"); return;
      case "for": emit("for ("); if (node.initial) expression(node.initial); emit("; "); if (node.condition) expression(node.condition); emit("; "); if (node.update) expression(node.update); emit(")\n"); controlled(node.body, depth); return;
      case "foreach": emit(`for (${node.variable} in ${node.array})\n`); controlled(node.body, depth); return;
    }
    emit("\n");
  };
  for (const [name, fn] of program.functions) { emit(`function ${name}(${fn.parameters.join(", ")})\n`); statement(fn.body, 0); emit("\n"); }
  for (const node of program.begin) { emit("BEGIN "); statement(node, 0); emit("\n"); }
  for (const rule of program.rules) {
    if (rule.pattern) { expression(rule.pattern); if (rule.end) { emit(", "); expression(rule.end); } emit(" "); }
    statement(rule.action, 0); emit("\n");
  }
  for (const node of program.end) { emit("END "); statement(node, 0); emit("\n"); }
  return output;
}
