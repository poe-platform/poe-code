import {
  REGEX_COMPILE_LIMITS,
  SandboxError,
  type CompileOwner,
  type CompileTicket
} from "../budget.js";
import type { RegexNode, RegexPattern } from "./parse.js";

const compiledData = new WeakMap<RegexPattern, { units: number; ticket?: CompileTicket }>();

export class CompileScope {
  readonly tickets = new Set<CompileTicket>();
  closed = false;

  constructor(
    readonly owner?: CompileOwner,
    readonly parent?: CompileScope
  ) {}

  forward(tickets: Iterable<CompileTicket>, parent: CompileScope): void {
    if (parent === this) return;
    if (this.owner !== parent.owner) throw new SandboxError("reentry");
    for (const ticket of tickets) {
      if (!this.tickets.delete(ticket)) continue;
      if (ticket.owner.budget.compileTicketUsage(ticket) > 0) parent.tickets.add(ticket);
    }
  }

  dispose(): void {
    for (const ticket of this.tickets) ticket.owner.budget.discardCompileTicket(ticket);
    this.tickets.clear();
    this.closed = true;
  }
}

export class RegexCompileGuard {
  private allocations = 0;
  private depth = 0;
  private readonly ticket?: CompileTicket;
  private retained = false;

  constructor(private readonly scope?: CompileScope) {
    if (scope?.owner !== undefined) {
      this.ticket = scope.owner.budget.createCompileTicket(scope.owner);
      scope.tickets.add(this.ticket);
    }
  }

  checkLength(length: number, flags = false): void {
    const hard = flags ? REGEX_COMPILE_LIMITS.flagsLength : REGEX_COMPILE_LIMITS.sourceLength;
    const limit = Math.min(hard, this.scope?.owner?.budget.limits.stringLength ?? hard);
    if (length > limit) throw new SandboxError({ budget: "stringLength", current: length, limit });
  }

  work(units: number): void {
    const budget = this.scope?.owner?.budget;
    if (budget === undefined) return;
    for (let index = 0; index < units; index += 1) budget.visitNode();
  }

  allocate(units: number): void {
    const next = this.allocations + units;
    if (next > REGEX_COMPILE_LIMITS.allocations) {
      throw new SandboxError({
        budget: "dataSize",
        current: next,
        limit: REGEX_COMPILE_LIMITS.allocations
      });
    }
    this.work(units);
    if (this.ticket !== undefined) {
      this.ticket.owner.budget.resizeCompileTicket(this.ticket, next);
    }
    this.allocations = next;
  }

  array(length: number): void {
    this.scope?.owner?.budget.allocateArrayLength(length);
    this.allocate(1);
  }

  enterGroup(): void {
    const next = this.depth + 1;
    if (next > REGEX_COMPILE_LIMITS.depth) {
      throw new SandboxError({
        budget: "dataDepth",
        current: next,
        limit: REGEX_COMPILE_LIMITS.depth
      });
    }
    this.depth = next;
  }

  leaveGroup(): void {
    this.depth -= 1;
  }

  preflight(source: string, flags: string): void {
    this.checkLength(source.length);
    this.checkLength(flags.length, true);
    let escaped = false;
    let characterClass = false;
    let nesting = 0;
    for (let position = 0; position < source.length; position += 1) {
      this.work(1);
      const character = source[position];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "[" && !characterClass) {
        characterClass = true;
      } else if (character === "]" && characterClass) {
        characterClass = false;
      } else if (!characterClass && character === "(") {
        nesting += 1;
        this.enterGroup();
      } else if (!characterClass && character === ")" && nesting > 0) {
        nesting -= 1;
        this.leaveGroup();
      }
    }
    this.depth = 0;
    this.work(flags.length);
  }

  retain(pattern: RegexPattern, valueUnits = 0): void {
    const units = 10 + pattern.source.length + measureNode(pattern.body);
    if (this.ticket !== undefined) {
      this.ticket.owner.budget.resizeCompileTicket(this.ticket, units + valueUnits);
    }
    compiledData.set(pattern, { units, ticket: this.ticket });
    this.retained = true;
  }

  retainScratch(): void {
    this.retained = true;
  }

  close(): void {
    if (this.retained || this.ticket === undefined) return;
    this.ticket.owner.budget.discardCompileTicket(this.ticket);
    this.scope?.tickets.delete(this.ticket);
  }
}

export function regexCompiledData(pattern: RegexPattern): {
  units: number;
  ticket?: CompileTicket;
} {
  return (
    compiledData.get(pattern) ?? { units: 10 + pattern.source.length + measureNode(pattern.body) }
  );
}

function measureNode(node: RegexNode): number {
  switch (node.type) {
    case "empty":
    case "dot":
      return 2;
    case "literal":
      return 3 + node.value.length;
    case "anchor":
    case "wordBoundary":
      return 3;
    case "characterClass": {
      let usage = 5 + node.items.length;
      for (const item of node.items) {
        usage +=
          item.type === "character"
            ? 3 + item.value.length
            : item.type === "range"
              ? 4 + item.from.length + item.to.length
              : 4;
      }
      return usage;
    }
    case "sequence":
    case "alternation": {
      const children = node.type === "sequence" ? node.elements : node.alternatives;
      let usage = 4 + children.length;
      for (const child of children) usage += measureNode(child);
      return usage;
    }
    case "group":
      return 5 + measureNode(node.body);
    case "lookahead":
    case "lookbehind":
      return 4 + measureNode(node.body);
    case "quantifier":
      return (Object.hasOwn(node, "max") ? 6 : 5) + measureNode(node.body);
  }
}
