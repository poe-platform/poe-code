import { shellValueByteLength } from "../contracts/value.js";
import type { ShellValue } from "../contracts/value.js";
import { yieldTurn } from "../contracts/yield.js";
import type { Word, WordPart } from "./parser.js";
import { expansionSpellings, parseBraceWord } from "./parser.js";
import { ShellSyntaxError } from "./types.js";
import type { Budget } from "./runtime.js";

type Node = { count: number; bytes: number } & (
  | { kind: "part"; part: WordPart }
  | { kind: "product"; children: Node[] }
  | { kind: "choice"; children: Node[] }
  | { kind: "range"; start: bigint; step: bigint; width: number; numeric: boolean }
);

interface Frame {
  branches: Node[][];
}

export class BraceExpansionFailure extends Error {}

async function integer(text: string, checkpoint: () => Promise<void>): Promise<bigint | undefined> {
  let offset = text.startsWith("-") || text.startsWith("+") ? 1 : 0;
  if (offset === text.length) return undefined;
  while (text[offset] === "0") { if (offset % 1024 === 0) await checkpoint(); offset++; }
  if (text.length - offset > 19) return undefined;
  for (let index = offset; index < text.length; index++) if (text[index]! < "0" || text[index]! > "9") return undefined;
  const value = BigInt(text.slice(offset) || "0") * (text.startsWith("-") ? -1n : 1n);
  return value < -9223372036854775808n || value > 9223372036854775807n ? undefined : value;
}

export async function* expandBraces(word: Word, budget: Budget, signal: AbortSignal): AsyncGenerator<Word> {
  const allocation = budget.values.scope();
  let work = 0;
  let changed = false;
  const checkpoint = async (): Promise<void> => {
    budget.cpuCheckpoint();
    signal.throwIfAborted();
    if (++work % 128 === 0) await yieldTurn(signal);
  };
  const admit = (bytes = 64): void => {
    budget.parsing.admit();
    allocation.reserve(bytes, 0);
  };
  const sum = (left: number, right: number, limit: "maxExpansionFields" | "maxExpansionBytes"): number => {
    if (right > budget.limits[limit] - left) budget.fail(limit);
    return left + right;
  };
  const multiply = (left: number, right: number, limit: "maxExpansionFields" | "maxExpansionBytes"): number => {
    if (left !== 0 && right > Math.floor(budget.limits[limit] / left)) budget.fail(limit);
    return left * right;
  };
  const partNode = (part: WordPart): Node => {
    admit();
    return { kind: "part", part, count: 1, bytes: part.kind === "text" ? shellValueByteLength(part.byteValue ?? part.value) : 0 };
  };
  const textNode = (value: string): Node => {
    admit(value.length * 2);
    return partNode({ kind: "text", value, quoted: false });
  };
  const product = async (children: Node[]): Promise<Node> => {
    admit();
    let count = 1;
    let bytes = 0;
    for (const child of children) {
      await checkpoint();
      bytes = sum(multiply(bytes, child.count, "maxExpansionBytes"), multiply(child.bytes, count, "maxExpansionBytes"), "maxExpansionBytes");
      count = multiply(count, child.count, "maxExpansionFields");
    }
    return { kind: "product", children, count, bytes };
  };
  const sequence = async (children: Node[]): Promise<Node | undefined> => {
    if (children.length !== 1 || children[0]!.kind !== "part") return undefined;
    const part = children[0]!.part;
    if (part.kind !== "text" || part.quoted || part.byteValue) return undefined;
    admit(32);
    const pieces: string[] = [];
    let startOffset = 0;
    for (let offset = 0; offset < part.value.length; offset++) {
      if (offset % 1024 === 0) await checkpoint();
      if (part.value[offset] !== "." || part.value[offset + 1] !== ".") continue;
      if (pieces.length === 2) return undefined;
      admit(16 + (offset - startOffset) * 2);
      pieces.push(part.value.slice(startOffset, offset));
      startOffset = offset + 2;
      offset++;
    }
    if (!pieces.length) return undefined;
    admit(16 + (part.value.length - startOffset) * 2);
    pieces.push(part.value.slice(startOffset));
    const first = pieces[0]!;
    const last = pieces[1]!;
    admit(256);
    let start = await integer(first, checkpoint);
    let end = await integer(last, checkpoint);
    const numeric = start !== undefined && end !== undefined;
    if (!numeric) {
      const alphabetic = (value: string): boolean => value.length === 1 && (value >= "a" && value <= "z" || value >= "A" && value <= "Z");
      if (!alphabetic(first) || !alphabetic(last)) return undefined;
      start = BigInt(first.charCodeAt(0));
      end = BigInt(last.charCodeAt(0));
    }
    let step = pieces.length === 3 ? await integer(pieces[2]!, checkpoint) : 1n;
    if (step === undefined) return undefined;
    if (step < 0n) step = -step;
    if (step === 0n) step = 1n;
    const distance = end! - start!;
    const cardinality = (distance < 0n ? -distance : distance) / step + 1n;
    if (cardinality > BigInt(budget.limits.maxExpansionFields)) budget.fail("maxExpansionFields");
    const padded = (value: string): boolean => value.length > 1 && value.startsWith("0") || value.length > 2 && value.startsWith("-0");
    const width = numeric && (padded(first) || padded(last)) ? Math.max(first.length, last.length) : 0;
    const count = Number(cardinality);
    const termBytes = numeric ? Math.max(width, start!.toString().length, end!.toString().length) : 1;
    const bytes = multiply(count, termBytes, "maxExpansionBytes");
    admit();
    return { kind: "range", start: start!, step: distance < 0n ? -step : step, width, numeric, count, bytes };
  };
  try {
    admit();
    const frames: Frame[] = [{ branches: [[]] }];
    const append = (node: Node): void => { frames.at(-1)!.branches.at(-1)!.push(node); };
    for (const part of word.parts) {
      await checkpoint();
      if (part.kind !== "text" || part.quoted || part.byteValue) { append(partNode(part)); continue; }
      let start = 0;
      for (let offset = 0; offset < part.value.length; offset++) {
        if (offset % 1024 === 0) { budget.parsing.admit(); await checkpoint(); }
        const character = part.value[offset]!;
        if (character !== "{" && character !== "}" && character !== ",") continue;
        if (start < offset) {
          admit((offset - start) * 2);
          append(textNode(part.value.slice(start, offset)));
        }
        start = offset + 1;
        if (character === "{") { admit(); frames.push({ branches: [[]] }); }
        else if (character === "," && frames.length > 1) { admit(); frames.at(-1)!.branches.push([]); }
        else if (character === "}" && frames.length > 1) {
          const frame = frames.pop()!;
          if (frame.branches.length > 1) {
            admit(frame.branches.length * 8);
            const children: Node[] = [];
            for (const branch of frame.branches) children.push(await product(branch));
            let count = 0;
            let bytes = 0;
            for (const child of children) { await checkpoint(); count = sum(count, child.count, "maxExpansionFields"); bytes = sum(bytes, child.bytes, "maxExpansionBytes"); }
            append({ kind: "choice", children, count, bytes });
            changed = true;
          } else {
            const children = frame.branches[0]!;
            const range = await sequence(children);
            if (range) { append(range); changed = true; }
            else { append(textNode("{")); append(await product(children)); append(textNode("}")); }
          }
        } else append(textNode(character));
      }
      if (start < part.value.length) {
        if (start === 0) append(partNode(part));
        else { admit((part.value.length - start) * 2); append(textNode(part.value.slice(start))); }
      }
    }
    while (frames.length > 1) {
      await checkpoint();
      const frame = frames.pop()!;
      append(textNode("{"));
      for (let index = 0; index < frame.branches.length; index++) {
        if (index) append(textNode(","));
        append(await product(frame.branches[index]!));
      }
    }
    if (!changed) { yield word; return; }
    const root = await product(frames[0]!.branches[0]!);
    for (let rank = 0; rank < root.count; rank++) {
      await checkpoint();
      const materialized = budget.values.scope();
      try {
        materialized.reserve(64, 0);
        const parts: WordPart[] = [];
        const generatedSyntax = new WeakSet<WordPart>();
        const pending = [{ node: root, rank }];
        while (pending.length) {
          await checkpoint();
          const current = pending.pop()!;
          const node = current.node;
          if (node.kind === "product") {
            materialized.reserve(node.children.length * 32, 0);
            let divisor = 1;
            for (let index = node.children.length - 1; index >= 0; index--) {
              await checkpoint();
              const child = node.children[index]!;
              pending.push({ node: child, rank: Math.floor(current.rank / divisor) % child.count });
              divisor *= child.count;
            }
          } else if (node.kind === "choice") {
            let choice = current.rank;
            for (const child of node.children) {
              await checkpoint();
              if (choice < child.count) { materialized.reserve(32, 0); pending.push({ node: child, rank: choice }); break; }
              choice -= child.count;
            }
          } else {
            materialized.reserve(64, 0);
            let part: WordPart;
            if (node.kind === "part") part = node.part;
            else {
              const value = node.start + BigInt(current.rank) * node.step;
              materialized.reserve(Math.max(node.width, 32) * 2, 0);
              const digits = node.numeric ? (value < 0n ? -value : value).toString() : String.fromCharCode(Number(value));
              const text = node.numeric ? (value < 0n ? "-" : "") + digits.padStart(node.width - Number(value < 0n), "0") : digits;
              part = { kind: "text", value: text, quoted: false };
              if (!node.numeric && (text === "\\" || text === "`")) { materialized.reserve(32, 0); generatedSyntax.add(part); }
            }
            const previous = parts.at(-1);
            if (part.kind === "text" && !part.quoted && !part.byteValue && !generatedSyntax.has(part) && previous?.kind === "text" && !previous.quoted && !previous.byteValue && !generatedSyntax.has(previous)) {
              materialized.reserve((previous.value.length + part.value.length) * 2, 0);
              parts[parts.length - 1] = { kind: "text", value: previous.value + part.value, quoted: false };
            } else parts.push(part);
          }
        }
        for (let index = 0; index < parts.length; index++) {
          await checkpoint();
          const part = parts[index]!;
          if (!generatedSyntax.has(part) || part.kind !== "text") continue;
          materialized.reserve(128, 0);
          const fragments: string[] = [];
          const opaque = new Map<number, ShellValue>();
          let length = 0;
          for (let position = index; position < parts.length; position++) {
            await checkpoint();
            const current = parts[position]!;
            const spelling = expansionSpellings.get(current);
            materialized.reserve(32, 0);
            let fragment: string;
            if (current.kind === "text" && current.byteValue) {
              materialized.reserve(64, 0);
              opaque.set(length + 1, current.byteValue);
              fragment = "'\0'";
            } else if (current.kind === "text" && spelling?.ansi) {
              materialized.reserve(current.value.length * 8 + 4, 0);
              fragment = "'" + current.value.replaceAll("'", "'\\''") + "'";
            } else if (spelling && (current.kind !== "text" || current.quoted)) {
              materialized.reserve((spelling.end - spelling.start) * 2, 0);
              fragment = spelling.source.slice(spelling.start, spelling.end);
            } else if (current.kind === "text") fragment = current.value;
            else throw new BraceExpansionFailure("Missing lexical provenance in brace expansion");
            length = sum(length, fragment.length, "maxExpansionBytes");
            fragments.push(fragment);
          }
          materialized.reserve(length * 2, 0);
          let replayed: Word;
          try { replayed = parseBraceWord(fragments.join(""), opaque, budget.parsing); }
          catch (error) {
            if (!(error instanceof ShellSyntaxError)) throw error;
            throw new BraceExpansionFailure(error.reason);
          }
          materialized.reserve(replayed.parts.length * 32, 0);
          parts.length = index;
          for (const replayedPart of replayed.parts) parts.push(replayedPart);
          break;
        }
        yield { parts, offset: word.offset };
      } finally { materialized.close(); }
    }
  } finally { allocation.close(); }
}
