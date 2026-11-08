import type { FileSystem } from "../contracts/index.js";
import { isFsError, resolvePath } from "../contracts/index.js";
import type { Word } from "./parser.js";
import { matchesPattern } from "./pattern.js";

export type ConditionalExpression =
  | { kind: "nonempty"; operand: Word }
  | { kind: "unary"; operator: string; operand: Word }
  | { kind: "binary"; operator: string; left: Word; right: Word }
  | { kind: "not"; operand: ConditionalExpression }
  | { kind: "and"; left: ConditionalExpression; right: ConditionalExpression }
  | { kind: "or"; left: ConditionalExpression; right: ConditionalExpression };

export const conditionalUnary = new Set(["-n", "-z", "-e", "-a", "-f", "-d", "-s", "-L", "-h", "-r", "-w", "-x", "-v", "-o", "-b", "-c", "-p", "-S", "-t", "-O", "-G", "-R", "-N", "-u", "-g", "-k"]);
export const conditionalBinary = new Set(["=", "==", "!=", "<", ">", "=~", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);

export class ConditionalUnsupported extends Error {}

interface ConditionalContext {
  readonly fs: FileSystem;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly locale: string;
  readonly work: { remaining: number; signal: AbortSignal; exhausted: () => never };
  expand(word: Word, pattern?: boolean): Promise<string>;
  regex?(subject: string, pattern: Word): Promise<number>;
  present(name: string): boolean;
  option(name: string): boolean;
}

function unsupported(detail: string): never { throw new ConditionalUnsupported(`[[ ${detail}: unsupported conditional profile`); }

async function charge(context: ConditionalContext, amount = 1): Promise<void> {
  context.signal.throwIfAborted();
  if (amount > context.work.remaining) context.work.exhausted();
  const previous = context.work.remaining;
  context.work.remaining -= amount;
  if ((previous >>> 10) !== (context.work.remaining >>> 10)) {
    await new Promise<void>(resolve => setImmediate(resolve));
    context.signal.throwIfAborted();
  }
}

function cLocale(context: ConditionalContext): void {
  if (context.locale !== "C" && context.locale !== "POSIX") unsupported("collation locale");
}

async function patternAdmission(pattern: string, context: ConditionalContext): Promise<void> {
  cLocale(context);
  let bracket = false;
  let bracketStart = 0;
  for (let index = 0; index < pattern.length; index++) {
    await charge(context);
    const character = pattern[index]!;
    if (character === "\\") { if (++index < pattern.length) await charge(context); continue; }
    if ("?*+@!".includes(character) && pattern[index + 1] === "(") unsupported("extglob");
    if (character === "[") {
      if (bracket || [":", ".", "="].includes(pattern[index + 1] ?? "")) unsupported("bracket class or collation");
      bracket = true; bracketStart = index;
    } else if (character === "]" && bracket && index > bracketStart + 1) bracket = false;
  }
  if (bracket) unsupported("unclosed bracket pattern");
}

async function integer(value: string, context: ConditionalContext): Promise<bigint> {
  await charge(context, value.length);
  const text = value.trim();
  if (!text) return 0n;
  let position = 0, sign = 1n;
  if (text[position] === "+" || text[position] === "-") { if (text[position] === "-") sign = -1n; position++; }
  let base = 10;
  const separator = text.indexOf("#", position);
  if (separator >= 0) {
    base = 0;
    if (separator === position) unsupported("numeric literal");
    while (position < separator) {
      const digit = text.charCodeAt(position++) - 48;
      if (digit < 0 || digit > 9 || base > 64) unsupported("numeric literal");
      base = base * 10 + digit;
    }
    if (base < 2 || base > 64) unsupported("numeric base");
    position++;
  } else if (text.slice(position, position + 2).toLowerCase() === "0x") { base = 16; position += 2; }
  else if (text[position] === "0" && position + 1 < text.length) base = 8;
  if (position >= text.length) unsupported("numeric literal");
  let result = 0n;
  const digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@_";
  for (; position < text.length; position++) {
    await charge(context);
    const character = text[position]!;
    const digit = digits.indexOf(base <= 36 ? character.toLowerCase() : character);
    if (digit < 0 || digit >= base) unsupported("numeric expression or literal");
    result = BigInt.asIntN(64, result * BigInt(base) + BigInt(digit));
  }
  return BigInt.asIntN(64, result * sign);
}

async function unary(operator: string, value: string, context: ConditionalContext): Promise<boolean> {
  if (operator === "-n") return value.length > 0;
  if (operator === "-z") return value.length === 0;
  if (operator === "-v") {
    if (value.endsWith("[@]") || value.endsWith("[*]")) unsupported("aggregate variable selector");
    return context.present(value);
  }
  if (operator === "-o") return context.option(value);
  if (!["-e", "-a", "-f", "-d", "-s", "-L", "-h", "-r", "-w", "-x"].includes(operator)) unsupported(operator);
  if (value === "") return false;
  if (/^\/dev\/(?:fd(?:\/|$)|stdin$|stdout$|stderr$)/u.test(value)) unsupported("descriptor predicate");
  const access = ["-r", "-w", "-x"].includes(operator);
  if (access && context.fs.capabilities.permissions !== true) unsupported("unobservable access permission");
  try {
    if (access) {
      await context.fs.access(resolvePath(context.cwd, value), operator === "-r" ? 4 : operator === "-w" ? 2 : 1, { signal: context.signal });
      context.signal.throwIfAborted(); return true;
    }
    const metadata = await (operator === "-L" || operator === "-h" ? context.fs.lstat(resolvePath(context.cwd, value), { signal: context.signal }) : context.fs.stat(resolvePath(context.cwd, value), { signal: context.signal }));
    context.signal.throwIfAborted();
    if (operator === "-f") return metadata.type === "file";
    if (operator === "-d") return metadata.type === "directory";
    if (operator === "-s") return metadata.size > 0;
    if (operator === "-L" || operator === "-h") return metadata.type === "symlink";
    return true;
  } catch (error) {
    context.signal.throwIfAborted();
    if (!isFsError(error)) throw error;
    const errno = error.code;
    if (errno === "ENOENT" || errno === "ENOTDIR" || errno === "EACCES" || errno === "EPERM") return false;
    if (access && errno === "EROFS") return false;
    if (errno === "ENOTSUP" || errno === "EOPNOTSUPP" || errno === "ENOSYS") unsupported("filesystem capability");
    throw error;
  }
}

async function leaf(node: Extract<ConditionalExpression, { kind: "nonempty" | "unary" | "binary" }>, context: ConditionalContext): Promise<boolean | number> {
  if (node.kind === "nonempty") return (await context.expand(node.operand)).length > 0;
  if (node.kind === "unary") return unary(node.operator, await context.expand(node.operand), context);
  const left = await context.expand(node.left);
  if (node.operator === "=~" && context.regex) return context.regex(left, node.right);
  const pattern = ["=", "==", "!="].includes(node.operator);
  const right = await context.expand(node.right, pattern);
  if (node.operator === "=~" || ["-nt", "-ot", "-ef"].includes(node.operator)) unsupported(node.operator);
  if (pattern) {
    await patternAdmission(right, context);
    const match = await matchesPattern(right, left, context.work);
    return node.operator === "!=" ? !match : match;
  }
  if (node.operator === "<" || node.operator === ">") {
    cLocale(context);
    await charge(context, Buffer.byteLength(left) + Buffer.byteLength(right));
    const order = Buffer.compare(Buffer.from(left), Buffer.from(right));
    return node.operator === "<" ? order < 0 : order > 0;
  }
  const first = await integer(left, context), second = await integer(right, context);
  switch (node.operator) {
    case "-eq": return first === second;
    case "-ne": return first !== second;
    case "-lt": return first < second;
    case "-le": return first <= second;
    case "-gt": return first > second;
    case "-ge": return first >= second;
    default: return unsupported(node.operator);
  }
}

export async function evaluateConditional(expression: ConditionalExpression, context: ConditionalContext): Promise<number> {
  const stack: { node: ConditionalExpression; stage: number }[] = [{ node: expression, stage: 0 }];
  let result = 1;
  while (stack.length) {
    await charge(context);
    const frame = stack.at(-1)!, node = frame.node;
    if (node.kind === "not") {
      if (frame.stage++ === 0) stack.push({ node: node.operand, stage: 0 });
      else { result = result === 0 ? 1 : 0; stack.pop(); }
    } else if (node.kind === "and" || node.kind === "or") {
      if (frame.stage === 0) { frame.stage = 1; stack.push({ node: node.left, stage: 0 }); }
      else if (frame.stage === 1 && (node.kind === "and" ? result === 0 : result !== 0)) { frame.stage = 2; stack.push({ node: node.right, stage: 0 }); }
      else stack.pop();
    } else { const value = await leaf(node, context); result = typeof value === "number" ? value : Number(!value); stack.pop(); }
  }
  context.signal.throwIfAborted();
  return result;
}
