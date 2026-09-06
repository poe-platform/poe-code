import { allocateRegexSteps } from "../budget.js";
import type { CharacterClassItem, RegexFlags, RegexNode, RegexPattern } from "./parse.js";

export type RegexMatch = {
  index: number;
  text: string;
  captures: (string | undefined)[];
  indices?: ([number, number] | undefined)[];
  groups?: Record<string, string | undefined>;
  indicesGroups?: Record<string, [number, number] | undefined>;
};

type Capture = { start: number; end: number } | undefined;
type MatchState = { position: number; captures: Capture[] };
type MatchContext = { input: string; flags: RegexFlags; groups?: Record<string, number[]>; direction: 1 | -1; work: { steps: number } };

export function matchRegex(pattern: RegexPattern, input: string, lastIndex = 0): RegexMatch | null {
  const startIndex = pattern.flags.global || pattern.flags.sticky ? normalizeLastIndex(lastIndex) : 0;
  return matchRegexFrom(pattern, input, startIndex);
}

export function matchRegexFrom(
  pattern: RegexPattern,
  input: string,
  startIndex: number
): RegexMatch | null {
  if (startIndex > input.length) {
    return null;
  }

  if (pattern.flags.unicode && startIndex > 0 && startIndex < input.length &&
      input.charCodeAt(startIndex) >= 0xdc00 && input.charCodeAt(startIndex) <= 0xdfff &&
      input.charCodeAt(startIndex - 1) >= 0xd800 && input.charCodeAt(startIndex - 1) <= 0xdbff) startIndex--;
  for (let attempt = startIndex; attempt <= input.length; attempt = advanceStringIndex(input, attempt, pattern.flags.unicode)) {
    const context: MatchContext = { input, flags: pattern.flags, groups: pattern.groups, direction: 1, work: { steps: 0 } };
    charge(context);
    const initialState: MatchState = {
      position: attempt,
      captures: new Array<Capture>(pattern.captureCount)
    };
    const result = matchNode(pattern.body, initialState, context).next();
    if (!result.done) {
      return toRegexMatch(input, attempt, result.value, pattern.flags.hasIndices, pattern.groups);
    }
    if (pattern.flags.sticky) break;
  }

  return null;
}

function* matchNode(
  node: RegexNode,
  state: MatchState,
  context: MatchContext
): Generator<MatchState> {
  charge(context);
  const character = readCharacter(context.input, state.position, context.direction, context.flags.unicode);

  switch (node.type) {
    case "empty":
      yield state;
      return;
    case "literal":
      if (charactersEqual(character, node.value, context.flags.ignoreCase, context.flags.unicode)) {
        yield { ...state, position: state.position + context.direction * character!.length };
      }
      return;
    case "backreference":
    case "namedBackreference": {
      let capture: Capture;
      if (node.type === "backreference") capture = state.captures[node.index - 1];
      else {
        for (const index of context.groups?.[node.name] ?? []) {
          charge(context);
          if (state.captures[index - 1] !== undefined) { capture = state.captures[index - 1]; break; }
        }
      }
      if (capture === undefined) {
        yield state;
        return;
      }
      let position = state.position;
      let reference = context.direction === 1 ? capture.start : capture.end;
      const end = context.direction === 1 ? capture.end : capture.start;
      while (reference !== end) {
        charge(context);
        const expected = readCharacter(context.input, reference, context.direction, context.flags.unicode)!;
        const actual = readCharacter(context.input, position, context.direction, context.flags.unicode);
        if (!charactersEqual(actual, expected, context.flags.ignoreCase, context.flags.unicode)) return;
        reference += context.direction * expected.length;
        position += context.direction * actual!.length;
      }
      yield { ...state, position };
      return;
    }
    case "dot":
      if (
        character !== undefined &&
        (context.flags.dotAll || !isLineTerminator(character))
      ) {
        yield { ...state, position: state.position + context.direction * character.length };
      }
      return;
    case "anchor":
      if (matchesAnchor(node.kind, state.position, context)) {
        yield state;
      }
      return;
    case "wordBoundary": {
      const previousWord = state.position > 0 && matchesCharacterClassItem(context.input[state.position - 1], { type: "kind", kind: "word", negated: false }, context.flags.ignoreCase, context.flags.unicode);
      const nextWord =
        state.position < context.input.length && matchesCharacterClassItem(context.input[state.position], { type: "kind", kind: "word", negated: false }, context.flags.ignoreCase, context.flags.unicode);
      if ((previousWord !== nextWord) !== node.negated) {
        yield state;
      }
      return;
    }
    case "characterClass": {
      if (
        character !== undefined &&
        matchesCharacterClass(character, node.items, node.negated, context)
      ) {
        yield { ...state, position: state.position + context.direction * character.length };
      }
      return;
    }
    case "sequence":
      yield* matchSequence(node.elements, 0, state, context);
      return;
    case "alternation":
      for (const alternative of node.alternatives) {
        yield* matchNode(alternative, cloneState(state), context);
      }
      return;
    case "lookahead":
    case "lookbehind": {
      const result = matchNode(node.body, cloneState(state), {
        ...context, direction: node.type === "lookbehind" ? -1 : 1
      }).next();
      if (node.negated) {
        if (result.done) yield state;
      } else if (!result.done) {
        yield { position: state.position, captures: result.value.captures };
      }
      return;
    }
    case "group":
      for (const result of matchNode(node.body, cloneState(state), context)) {
        if (!node.capturing || node.index === undefined) {
          yield result;
          continue;
        }
        const captures = result.captures.slice();
        captures[node.index - 1] = { start: Math.min(state.position, result.position), end: Math.max(state.position, result.position) };
        yield { position: result.position, captures };
      }
      return;
    case "quantifier":
      yield* matchQuantifier(node, state, context, 0);
  }
}

function* matchSequence(
  elements: RegexNode[],
  index: number,
  state: MatchState,
  context: MatchContext
): Generator<MatchState> {
  charge(context);
  if (index === elements.length) {
    yield state;
    return;
  }

  const element = elements[context.direction === 1 ? index : elements.length - 1 - index];
  for (const result of matchNode(element, state, context)) {
    yield* matchSequence(elements, index + 1, result, context);
  }
}

function* matchQuantifier(
  node: Extract<RegexNode, { type: "quantifier" }>,
  state: MatchState,
  context: MatchContext,
  count: number
): Generator<MatchState> {
  charge(context);
  const canRepeat = node.max === undefined || count < node.max;

  if (!node.greedy && count >= node.min) {
    yield state;
  }

  if (canRepeat) {
    for (const result of matchNode(node.body, clearCaptures(node.body, state), context)) {
      if (result.position === state.position) {
        if (count >= node.min) {
          continue;
        }
        if (count + 1 >= node.min) {
          yield result;
        } else {
          yield* matchQuantifier(node, result, context, count + 1);
        }
        continue;
      }
      yield* matchQuantifier(node, result, context, count + 1);
    }
  }

  if (node.greedy && count >= node.min) {
    yield state;
  }
}

function matchesAnchor(kind: "start" | "end", position: number, context: MatchContext): boolean {
  if (kind === "start") {
    return (
      position === 0 ||
      (context.flags.multiline && position > 0 && isLineTerminator(context.input[position - 1]))
    );
  }

  return (
    position === context.input.length ||
    (context.flags.multiline &&
      position < context.input.length &&
      isLineTerminator(context.input[position]))
  );
}

function matchesCharacterClass(
  character: string,
  items: CharacterClassItem[],
  negated: boolean,
  context: MatchContext
): boolean {
  const matched = items.some((item) => {
    if (context.flags.unicode) charge(context);
    return matchesCharacterClassItem(character, item, context.flags.ignoreCase, context.flags.unicode);
  });
  return negated ? !matched : matched;
}

function matchesCharacterClassItem(
  character: string,
  item: CharacterClassItem,
  ignoreCase: boolean,
  unicode: boolean
): boolean {
  if (unicode) {
    // Generated atoms only: the host classifies one code point, never executes a guest pattern.
    const hex = (value: string) => `\\u{${value.codePointAt(0)!.toString(16)}}`;
    let atom: string;
    if (item.type === "character") atom = hex(item.value);
    else if (item.type === "range") atom = `[${hex(item.from)}-${hex(item.to)}]`;
    else if (item.type === "property") atom = `\\${item.negated ? "P" : "p"}{${item.value}}`;
    else {
      const kind = item.kind === "digit" ? "d" : item.kind === "word" ? "w" : "s";
      atom = `\\${item.negated ? kind.toUpperCase() : kind}`;
    }
    return new RegExp(`^(?:${atom})$`, ignoreCase ? "iu" : "u").test(character);
  }
  if (item.type === "property") return false;
  if (item.type === "character") {
    return charactersEqual(character, item.value, ignoreCase);
  }
  if (item.type === "range") {
    const candidate = character.charCodeAt(0);
    const from = item.from.charCodeAt(0);
    const to = item.to.charCodeAt(0);
    if (candidate >= from && candidate <= to) {
      return true;
    }
    if (!ignoreCase) {
      return false;
    }

    const foldedCandidate = foldCharacter(character, true).charCodeAt(0);
    const foldedFrom = foldCharacter(item.from, true).charCodeAt(0);
    const foldedTo = foldCharacter(item.to, true).charCodeAt(0);
    return foldedCandidate >= foldedFrom && foldedCandidate <= foldedTo;
  }

  const matched =
    item.kind === "digit"
      ? isDigit(character)
      : item.kind === "word"
        ? isWordCharacter(character)
        : isSpaceCharacter(character);
  return item.negated ? !matched : matched;
}

function toRegexMatch(input: string, start: number, state: MatchState, hasIndices: boolean, groups?: Record<string, number[]>): RegexMatch {
  const match: RegexMatch = {
    index: start,
    text: input.slice(start, state.position),
    captures: state.captures.map((capture) =>
      capture === undefined ? undefined : input.slice(capture.start, capture.end)
    )
  };
  if (hasIndices) {
    match.indices = [[start, state.position], ...state.captures.map((capture): [number, number] | undefined =>
      capture === undefined ? undefined : [capture.start, capture.end])];
  }
  if (groups !== undefined) {
    match.groups = Object.create(null) as Record<string, string | undefined>;
    if (hasIndices) match.indicesGroups = Object.create(null) as Record<string, [number, number] | undefined>;
    for (const [name, indices] of Object.entries(groups)) {
      const index = indices.find(index => state.captures[index - 1] !== undefined);
      match.groups[name] = index === undefined ? undefined : match.captures[index - 1];
      if (match.indicesGroups !== undefined) match.indicesGroups[name] = index === undefined ? undefined : match.indices![index];
    }
  }
  return match;
}

function cloneState(state: MatchState): MatchState {
  return { position: state.position, captures: state.captures.slice() };
}

function clearCaptures(node: RegexNode, state: MatchState): MatchState {
  const captures = state.captures.slice();
  clearNodeCaptures(node, captures);
  return { position: state.position, captures };
}

function clearNodeCaptures(node: RegexNode, captures: Capture[]): void {
  if (node.type === "group") {
    if (node.capturing && node.index !== undefined) {
      captures[node.index - 1] = undefined;
    }
    clearNodeCaptures(node.body, captures);
    return;
  }
  if (node.type === "sequence") {
    for (const element of node.elements) {
      clearNodeCaptures(element, captures);
    }
    return;
  }
  if (node.type === "alternation") {
    for (const alternative of node.alternatives) {
      clearNodeCaptures(alternative, captures);
    }
    return;
  }
  if (node.type === "quantifier" || node.type === "lookahead" || node.type === "lookbehind") {
    clearNodeCaptures(node.body, captures);
  }
}

function charge(context: MatchContext): void {
  context.work.steps += 1;
  allocateRegexSteps(context.work.steps);
}

export function normalizeLastIndex(lastIndex: number): number {
  if (Number.isNaN(lastIndex) || lastIndex <= 0) {
    return 0;
  }
  return Math.min(Math.floor(lastIndex), Number.MAX_SAFE_INTEGER);
}

function charactersEqual(left: string | undefined, right: string, ignoreCase: boolean, unicode = false): boolean {
  if (unicode && ignoreCase && left !== undefined)
    return new RegExp(`^\\u{${right.codePointAt(0)!.toString(16)}}$`, "iu").test(left);
  return left !== undefined && foldCharacter(left, ignoreCase) === foldCharacter(right, ignoreCase);
}

export function advanceStringIndex(input: string, index: number, unicode: boolean): number {
  return index + (unicode && (input.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

function readCharacter(input: string, position: number, direction: 1 | -1, unicode: boolean): string | undefined {
  let index = direction === 1 ? position : position - 1;
  if (index < 0 || index >= input.length) return undefined;
  if (unicode && direction === -1 && index > 0 &&
      input.charCodeAt(index) >= 0xdc00 && input.charCodeAt(index) <= 0xdfff &&
      input.charCodeAt(index - 1) >= 0xd800 && input.charCodeAt(index - 1) <= 0xdbff) index--;
  return unicode ? String.fromCodePoint(input.codePointAt(index)!) : input[index];
}

function foldCharacter(character: string, ignoreCase: boolean): string {
  if (!ignoreCase) {
    return character;
  }

  const folded = character.toUpperCase();
  if (folded.length !== 1) {
    return character;
  }
  if (character.charCodeAt(0) >= 0x80 && folded.charCodeAt(0) < 0x80) {
    return character;
  }
  return folded;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isWordCharacter(character: string): boolean {
  return (
    isDigit(character) ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    character === "_"
  );
}

function isSpaceCharacter(character: string): boolean {
  return (
    character === " " ||
    character === "\f" ||
    character === "\n" ||
    character === "\r" ||
    character === "\t" ||
    character === "\v" ||
    character === "\u00a0" ||
    character === "\u1680" ||
    (character >= "\u2000" && character <= "\u200a") ||
    character === "\u2028" ||
    character === "\u2029" ||
    character === "\u202f" ||
    character === "\u205f" ||
    character === "\u3000" ||
    character === "\ufeff"
  );
}

function isLineTerminator(character: string): boolean {
  return (
    character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029"
  );
}
