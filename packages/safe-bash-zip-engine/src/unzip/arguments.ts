import { yieldTurn } from "safe-bash-contracts/yield";
import { fail,type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";

type Token = { kind: "star"; crossDirectories: boolean } | { kind: "any" | "never" } | { kind: "literal"; value: string }
  | { kind: "class"; ranges: readonly [number, number][]; negative: boolean };

function tokenize(pattern: string, noWild: boolean, stopAtDirectories: boolean): Token[] {
  const characters = Array.from(pattern);
  const tokens: Token[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    if (character === "*" && !noWild) {
      let count = 1;
      while (characters[index + 1] === "*") { count++; index++; }
      tokens.push({ kind: "star", crossDirectories: !stopAtDirectories || count > 1 });
    }
    else if (character === "?") tokens.push({ kind: "any" });
    else if (character === "\\" && !noWild) {
      const escaped = characters[++index];
      tokens.push(escaped === undefined ? { kind: "never" } : { kind: "literal", value: escaped });
    } else if (character === "[" && !noWild) {
      const negative = characters[index + 1] === "!" || characters[index + 1] === "^";
      if (negative) index++;
      const ranges: [number, number][] = [];
      const start = index + 1;
      let closing = start;
      let escaped = false;
      for (; closing < characters.length; closing++) {
        const current = characters[closing];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === "]") break;
      }
      // Info-ZIP recmatch defers a character followed by '-' and uses the
      // immediately preceding character for each range. Chained and trailing
      // hyphens therefore differ from conventional glob character classes.
      let first: number | undefined;
      escaped = characters[start] === "-";
      for (let position = start; position < closing; position++) {
        const current = characters[position]!;
        if (!escaped && current === "\\") escaped = true;
        else if (!escaped && current === "-") first = characters[position - 1]!.codePointAt(0);
        else {
          const last = current.codePointAt(0)!;
          if (characters[position + 1] !== "-") ranges.push([first ?? last, last]);
          first = undefined;
          escaped = false;
        }
      }
      index = closing;
      tokens.push(closing < characters.length ? { kind: "class", ranges, negative } : { kind: "never" });
    } else tokens.push({ kind: "literal", value: character });
  }
  return tokens;
}

export class Selection {
  private work = 0;
  private readonly patterns: readonly Token[][];
  private readonly tailComponents: readonly number[];
  private readonly emptyTailMatch: readonly boolean[];
  readonly matched = new Set<number>();
  constructor(patterns: readonly string[], private readonly limits: ArchiveLimits, private readonly signal: AbortSignal, private readonly options: { noWild?: boolean; stopAtDirectories?: boolean; trailingComponents?: boolean; caseInsensitive?: boolean } = {}) {
    this.patterns = patterns.map(pattern => tokenize(options.caseInsensitive ? pattern.toLowerCase() : pattern, options.noWild === true, options.stopAtDirectories === true));
    this.tailComponents = patterns.map(pattern => pattern.split("/").length);
    this.emptyTailMatch = patterns.map(pattern => !options.noWild && (pattern === "*" || options.stopAtDirectories === true && pattern === "**"));
  }
  private step(): void {
    if (++this.work > this.limits.maxPatternSteps) fail("pattern work limit exceeded");
  }
  async matches(name: string, firstMatchOnly = false): Promise<boolean> {
    if (!this.patterns.length) return true;
    if (this.options.caseInsensitive) name = name.toLowerCase();
    const fullCharacters = Array.from(name);
    let selected = false;
    for (let pattern = 0; pattern < this.patterns.length; pattern++) {
      this.step();
      const characters = this.options.trailingComponents ? Array.from(name.split("/").slice(-this.tailComponents[pattern]!).join("/")) : fullCharacters;
      if (this.options.trailingComponents && !characters.length && !this.emptyTailMatch[pattern]) continue;
      let states = new Uint8Array(characters.length + 1);
      states[0] = 1;
      for (const token of this.patterns[pattern]!) {
        const next = new Uint8Array(states.length);
        for (let index = 0; index < states.length; index++) {
          this.step();
          if (token.kind === "star") next[index] = states[index]! || (index > 0 && (token.crossDirectories || characters[index - 1] !== "/") ? next[index - 1]! : 0);
          else if (states[index] && index < characters.length) {
            const character = characters[index]!;
            let match = token.kind === "any" && (!this.options.stopAtDirectories || character !== "/") || (token.kind === "literal" && token.value === character);
            if (token.kind === "class") {
              let inRange = false;
              for (const [first, last] of token.ranges) {
                this.step();
                if (character.codePointAt(0)! >= first && character.codePointAt(0)! <= last) inRange = true;
              }
              match = inRange !== token.negative;
            }
            if (match) next[index + 1] = 1;
          }
          if (this.work % 4096 === 0) await yieldTurn(this.signal);
        }
        states = next;
      }
      if (states[characters.length]) {
        this.matched.add(pattern);
        if (firstMatchOnly) return true;
        selected = true;
      }
    }
    return selected;
  }
}
