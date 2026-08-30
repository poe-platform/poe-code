import { performance } from "node:perf_hooks";

import { parse } from "../../src/parse.js";
import { adversarialFailure, minimizeSource } from "./report.js";
import { createRandom, pick, randomInt, type Random } from "./random.js";

export const PARSER_SMOKE_SEED = 0x51a7_2026;
const CASE_COUNT = process.env.SAFEJS_ADVERSARIAL_SLOW === "1" ? 5_000 : 160;
const MAX_DEPTH = 4;
const MAX_DURATION_MS = process.env.SAFEJS_ADVERSARIAL_SLOW === "1" ? 15_000 : 500;

const IDENTIFIERS = ["alpha", "beta", "count", "item", "value"] as const;
const LITERALS = ["null", "true", "false", "0", "1", "-1", '"text"'] as const;

export function runParserSmokeFuzzer(): void {
  const random = createRandom(PARSER_SMOKE_SEED);
  const startedAt = performance.now();

  for (let index = 0; index < CASE_COUNT; index += 1) {
    const source = index % 5 === 0 ? truncate(random, program(random)) : program(random);
    try {
      parse(source, `adversarial-${index}.ajs`);
    } catch (error) {
      if (!isDocumentedParseFailure(error)) {
        const minimized = minimizeSource(source, (candidate) =>
          hasUndocumentedParseFailure(candidate)
        );
        throw adversarialFailure({
          cause: error,
          kind: "source",
          seed: PARSER_SMOKE_SEED,
          value: minimized
        });
      }
    }
  }

  const duration = performance.now() - startedAt;
  if (duration > MAX_DURATION_MS) {
    throw adversarialFailure({
      cause: new Error(
        `case cap exceeded time cap: ${duration.toFixed(1)}ms > ${MAX_DURATION_MS}ms`
      ),
      kind: "source",
      seed: PARSER_SMOKE_SEED,
      value: "<bounded grammar corpus>"
    });
  }
}

function hasUndocumentedParseFailure(source: string): boolean {
  try {
    parse(source);
    return false;
  } catch (error) {
    return !isDocumentedParseFailure(error);
  }
}

function program(random: Random): string {
  const statements = Array.from({ length: 1 + randomInt(random, 4) }, () => statement(random));
  return `${statements.join("\n")}\nreturn ${expression(random, 0)};`;
}

function statement(random: Random): string {
  const name = pick(random, IDENTIFIERS);
  return pick(random, [
    `const ${name} = ${expression(random, 0)};`,
    `let ${name} = ${expression(random, 0)};`,
    `if (${expression(random, 0)}) { ${name}; } else { ${expression(random, 0)}; }`,
    `for (const ${name} of [${expression(random, 0)}]) { ${name}; }`,
    `try { ${expression(random, 0)}; } catch (error) { error; }`
  ]);
}

function expression(random: Random, depth: number): string {
  if (depth >= MAX_DEPTH || random() < 0.35) {
    return pick(random, [...LITERALS, ...IDENTIFIERS]);
  }

  const left = expression(random, depth + 1);
  const right = expression(random, depth + 1);
  return pick(random, [
    `(${left} + ${right})`,
    `(${left} === ${right})`,
    `(${left} ? ${right} : ${left})`,
    `[${left}, ${right}]`,
    `({ value: ${left}, other: ${right} })`,
    `String(${left})`,
    `JSON.stringify(${left})`
  ]);
}

function truncate(random: Random, source: string): string {
  return source.slice(0, randomInt(random, source.length + 1));
}

function isDocumentedParseFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ParseError" ||
      error.name === "DisallowedSyntaxError" ||
      error.name === "SyntaxError")
  );
}
