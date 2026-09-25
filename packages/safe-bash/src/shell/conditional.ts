import { yieldTurn } from "../contracts/yield.js";
import type { FileSystem } from "../contracts/index.js";
import { isFsError } from "../contracts/index.js";
import { pathOf } from "../commands/internal.js";
import type { Word } from "./parser.js";
import { matchesPattern } from "./pattern.js";
import { cCollation, utf8Locale } from "./locale.js";
import type { StringWork } from "./string-operations.js";
import { evaluateFilePredicate, type PredicateIdentity } from "../commands/file-predicates.js";

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
  readonly characterLocale?: string;
  readonly work: StringWork;
  readonly ignoreCase?: boolean;
  readonly extglob?: boolean;
  readonly predicateIdentity?: PredicateIdentity | undefined;
  expand(word: Word, pattern?: boolean): Promise<string>;
  arithmetic(value: string): bigint | Promise<bigint>;
  regex?(subject: string, pattern: Word): Promise<number>;
  present(name: string): Promise<boolean>;
  option(name: string): boolean;
  reference(name: string): boolean;
}

function unsupported(detail: string): never { throw new ConditionalUnsupported(`[[ ${detail}: unsupported conditional profile`); }

async function charge(context: ConditionalContext, amount = 1): Promise<void> {
  context.signal.throwIfAborted();
  if (amount > context.work.remaining) context.work.exhausted();
  const previous = context.work.remaining;
  context.work.remaining -= amount;
  if ((previous >>> 10) !== (context.work.remaining >>> 10)) {
    await yieldTurn();
    context.signal.throwIfAborted();
  }
}

function cLocale(context: ConditionalContext): void {
  if (!cCollation(context.locale)) unsupported("collation locale");
}

async function patternAdmission(pattern: string, context: ConditionalContext): Promise<void> {
  if (!cCollation(context.locale) && !utf8Locale(context.locale)) unsupported("collation locale");
  let bracket = false;
  let bracketStart = 0;
  for (let index = 0; index < pattern.length; index++) {
    await charge(context);
    const character = pattern[index]!;
    if (character === "\\") { if (++index < pattern.length) await charge(context); continue; }
    if (bracket && character === "-" && index > bracketStart + 1 && pattern[index + 1] !== "]") cLocale(context);
    if (!bracket && !context.extglob && "?*+@!".includes(character) && pattern[index + 1] === "(") unsupported("extglob");
    if (character === "[" && !bracket) {
      bracket = true;
      bracketStart = index + (["!", "^"].includes(pattern[index + 1] ?? "") ? 1 : 0);
    } else if (character === "[" && bracket) {
      const marker = pattern[index + 1];
      if (marker === "." || marker === "=") unsupported("bracket collation");
      if (marker === ":") {
        const characters = context.characterLocale ?? context.locale;
        if (characters !== "C" && characters !== "POSIX") unsupported("locale character class");
        while (index + 1 < pattern.length && !(pattern[index] === ":" && pattern[index + 1] === "]")) {
          index++;
          await charge(context);
        }
        if (index + 1 < pattern.length) { index++; await charge(context); }
      }
    } else if (character === "]" && bracket && index > bracketStart + 1) bracket = false;
  }
  if (bracket) unsupported("unclosed bracket pattern");
}

async function unary(operator: string, value: string, context: ConditionalContext): Promise<boolean> {
  if (operator === "-n") return value.length > 0;
  if (operator === "-z") return value.length === 0;
  if (operator === "-v") return context.present(value);
  if (operator === "-o") return context.option(value);
  if (operator === "-R") return context.reference(value);
  // Virtual shell descriptors do not expose terminal capabilities.
  if (operator === "-t") return false;
  if (["-b", "-p", "-S", "-u", "-g", "-k", "-O", "-G", "-N"].includes(operator)) {
    try { return await evaluateFilePredicate(context, operator, value, undefined, context.predicateIdentity); }
    catch (error) {
      context.signal.throwIfAborted();
      if (isFsError(error) && ["ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(error.code)) unsupported(error.message);
      throw error;
    }
  }
  if (!["-e", "-a", "-f", "-d", "-c", "-s", "-L", "-h", "-r", "-w", "-x"].includes(operator)) unsupported(operator);
  if (value === "") return false;
  if (/^\/dev\/(?:fd(?:\/|$)|stdin$|stdout$|stderr$)/u.test(value)) unsupported("descriptor predicate");
  const access = ["-r", "-w", "-x"].includes(operator);
  try {
    if (access) {
      const capabilities = await context.fs.capabilitiesFor?.(pathOf(context, value), { signal: context.signal }) ?? context.fs.capabilities;
      if (capabilities.permissions !== true) unsupported("unobservable access permission");
      await context.fs.access(pathOf(context, value), operator === "-r" ? 4 : operator === "-w" ? 2 : 1, { signal: context.signal });
      context.signal.throwIfAborted(); return true;
    }
    const metadata = await (operator === "-L" || operator === "-h" ? context.fs.lstat(pathOf(context, value), { signal: context.signal }) : context.fs.stat(pathOf(context, value), { signal: context.signal }));
    context.signal.throwIfAborted();
    if (operator === "-f") return metadata.type === "file";
    if (operator === "-c") return metadata.type === "character";
    if (operator === "-d") return metadata.type === "directory";
    if (operator === "-s") return metadata.size > 0;
    if (operator === "-L" || operator === "-h") return metadata.type === "symlink";
    return true;
  } catch (error) {
    context.signal.throwIfAborted();
    if (!isFsError(error)) throw error;
    const errno = error.code;
    if (errno === "ENOENT" || errno === "ENOTDIR" || errno === "EACCES" || errno === "EPERM" || errno === "ELOOP") return false;
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
  if (node.operator === "=~") unsupported(node.operator);
  if (["-nt", "-ot", "-ef"].includes(node.operator)) {
    try { return await evaluateFilePredicate(context, node.operator, left, right); }
    catch (error) {
      context.signal.throwIfAborted();
      if (isFsError(error) && ["ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(error.code)) unsupported("filesystem capability");
      throw error;
    }
  }
  if (pattern) {
    await patternAdmission(right, context);
    const match = await matchesPattern(right, left, context.work, context.ignoreCase, !!context.extglob);
    return node.operator === "!=" ? !match : match;
  }
  if (node.operator === "<" || node.operator === ">") {
    cLocale(context);
    await charge(context, Buffer.byteLength(left) + Buffer.byteLength(right));
    const order = Buffer.compare(Buffer.from(left), Buffer.from(right));
    return node.operator === "<" ? order < 0 : order > 0;
  }
  await charge(context, left.length + right.length);
  const first = await context.arithmetic(left), second = await context.arithmetic(right);
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
