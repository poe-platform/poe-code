import { patternNode, variable } from './pattern.js';
import { walk, type CodeNode, type CodeTree, type Language } from './tree.js';

/** many distinguishes a variadic capture even when it contains zero or one node. */
export interface Capture { many?: boolean; nodes: CodeNode[]; text: string; range: [number, number] }
export interface Match { node: CodeNode; captures: Record<string, Capture> }
export type Pattern = string | Rule;
export interface Rule {
  pattern?: string;
  kind?: string;
  regex?: string;
  all?: Pattern[];
  any?: Pattern[];
  not?: Pattern;
  inside?: Pattern;
  has?: Pattern;
  follows?: Pattern;
  precedes?: Pattern;
}
type Captures = Record<string, Capture>;
type Predicate = (node: CodeNode, captures: Captures) => Captures | undefined;
const ignored = new Set([',', ';']);
function children(node: CodeNode): CodeNode[] {
  const significant = node.children.filter(n => !n.trivia &&
    !((n.kind === 'JSXText' || n.kind === 'Text') && n.text.trim() === ''));
  return significant.filter((n, i) => {
    if (n.kind === ';') return node.kind === 'ForSpec';
    if (n.kind !== ',') return true;
    // Consecutive/leading array commas represent elisions, not separators.
    return node.kind === 'ArrayExpression' && (i === 1 || significant[i - 1]?.kind === ',');
  });
}
function same(a: CodeNode, b: CodeNode): boolean {
  if (a.kind !== b.kind) return false;
  const ac = children(a), bc = children(b);
  return ac.length || bc.length ? ac.length === bc.length && ac.every((n, i) => same(n, bc[i]!)) : a.text === b.text;
}
function capture(name: string, nodes: CodeNode[], owner: CodeNode, captures: Captures, many = false): Captures | undefined {
  if (!name || name === '_') return captures;
  const previous = captures[name];
  if (previous && (previous.nodes.length !== nodes.length || !nodes.every((n, i) => same(n, previous.nodes[i]!)))) return undefined;
  const start = nodes[0]?.range[0] ?? owner.range[0];
  const end = nodes.at(-1)?.range[1] ?? start;
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(owner.text).slice(start - owner.range[0], end - owner.range[0]));
  return { ...captures, [name]: { many, nodes, range: [start, end], text } };
}
function structural(pattern: CodeNode, node: CodeNode, captures: Captures): Captures | undefined {
  const meta = variable(pattern);
  if (meta) {
    // Lezer names syntax productions with initial capitals; punctuation/keywords
    // remain concrete tokens and cannot satisfy a single AST-node capture.
    if (node.trivia || node.kind === 'ERROR' || node.kind[0]! < 'A' || node.kind[0]! > 'Z') return undefined;
    return capture(meta.name, [node], node, captures, meta.many);
  }
  if (pattern.kind !== node.kind) return undefined;
  const ps = children(pattern), ns = children(node);
  if (!ps.length && !ns.length) return pattern.text === node.text ? captures : undefined;
  function sequence(pi: number, ni: number, state: Captures): Captures | undefined {
    if (pi === ps.length) return ni === ns.length ? state : undefined;
    const p = ps[pi]!;
    const v = variable(p);
    if (v?.many) {
      // Reluctant matching permits fixed suffixes and multiple variadics.
      for (let end = ni; end <= ns.length; end++) {
        const next = capture(v.name, ns.slice(ni, end), node, state, true);
        const result = next && sequence(pi + 1, end, next);
        if (result) return result;
      }
      return undefined;
    }
    if (ni === ns.length) return undefined;
    const next = structural(p, ns[ni]!, state);
    return next && sequence(pi + 1, ni + 1, next);
  }
  return sequence(0, 0, captures);
}
function* ancestors(node: CodeNode): IterableIterator<CodeNode> {
  for (let current = node.parent; current; current = current.parent) yield current;
}
function* siblings(node: CodeNode, direction: 'previousSibling' | 'nextSibling'): IterableIterator<CodeNode> {
  // Expression statements are transparent for relational queries on expressions.
  let current = node;
  while (current.parent?.kind === 'ExpressionStatement') current = current.parent;
  for (let sibling = current[direction]; sibling; sibling = sibling[direction]) {
    if (sibling.trivia || ignored.has(sibling.kind)) continue;
    yield sibling;
    if (sibling.kind === 'ExpressionStatement') yield* children(sibling);
  }
}
function compile(pattern: Pattern, language: Language): Predicate {
  if (typeof pattern === 'string') {
    const parsed = patternNode(pattern, language);
    return (node, captures) => structural(parsed, node, captures);
  }
  const tests: Predicate[] = [];
  if (pattern.pattern !== undefined) tests.push(compile(pattern.pattern, language));
  if (pattern.kind !== undefined) tests.push((node, captures) => node.kind === pattern.kind ? captures : undefined);
  if (pattern.regex !== undefined) {
    const regex = new RegExp(pattern.regex, 'u');
    tests.push((node, captures) => regex.test(node.text) ? captures : undefined);
  }
  for (const rule of pattern.all ?? []) tests.push(compile(rule, language));
  if (pattern.any !== undefined) {
    const alternatives = pattern.any.map(rule => compile(rule, language));
    tests.push((node, captures) => {
      for (const test of alternatives) { const result = test(node, captures); if (result) return result; }
      return undefined;
    });
  }
  if (pattern.not !== undefined) {
    const negative = compile(pattern.not, language);
    tests.push((node, captures) => negative(node, captures) ? undefined : captures);
  }
  const relations: [Pattern | undefined, (node: CodeNode) => Iterable<CodeNode>][] = [
    [pattern.inside, ancestors],
    [pattern.has, function* (node) { for (const child of node.children) yield* walk(child); }],
    [pattern.follows, node => siblings(node, 'previousSibling')],
    [pattern.precedes, node => siblings(node, 'nextSibling')]
  ];
  for (const [rule, relatives] of relations) {
    if (rule === undefined) continue;
    const test = compile(rule, language);
    tests.push((node, captures) => {
      for (const relative of relatives(node)) {
        if (relative.trivia) continue;
        const result = test(relative, captures);
        if (result) return result;
      }
      return undefined;
    });
  }
  return (node, captures) => {
    let state: Captures | undefined = captures;
    for (const test of tests) { state = test(node, state); if (!state) return undefined; }
    return state;
  };
}
/** Match one node. Captures use names without dollar prefixes. */
export function matchPattern(node: CodeNode, pattern: Pattern): Match | undefined {
  const captures = compile(pattern, node.language)(node, {});
  return captures ? { node, captures } : undefined;
}
/** Search in source order, compiling the pattern once per search. */
export function findMatches(tree: CodeTree | CodeNode, pattern: Pattern): Match[] {
  const root = 'root' in tree ? tree.root : tree;
  const test = compile(pattern, root.language);
  const result: Match[] = [];
  for (const node of walk(root)) {
    if (node.trivia || node.kind === 'ERROR') continue;
    const captures = test(node, {});
    if (captures) result.push({ node, captures });
  }
  return result;
}
