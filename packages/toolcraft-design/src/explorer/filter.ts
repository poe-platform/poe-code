import { graphemes } from "../dashboard/terminal-width.js";
import type { Row } from "./state.js";

export interface FilterMatch {
  index: number;
  score: number;
  positions: number[];
}

export interface FilterRowsOptions {
  caseSensitive?: boolean;
}

const MATCH_SCORE = 10;
const CONSECUTIVE_BONUS = 14;
const WORD_START_BONUS = 10;
const EARLY_MATCH_BONUS = 3;

export function filterRows(
  query: string,
  rows: readonly Row[],
  opts: FilterRowsOptions = {}
): FilterMatch[] {
  if (query.trim().length === 0) {
    return rows.map((_, index) => ({ index, score: 0, positions: [] }));
  }

  const preparedQuery = opts.caseSensitive === true ? query : query.toLocaleLowerCase();
  const matches: FilterMatch[] = [];

  rows.forEach((row, index) => {
    const text = searchableText(row);
    const preparedText = opts.caseSensitive === true ? text : text.toLocaleLowerCase();
    const match = matchSubsequence(preparedQuery, preparedText);

    if (match !== undefined) {
      matches.push({
        index,
        ...match,
        positions: text === preparedText ? match.positions : projectPositions(text, match.positions)
      });
    }
  });

  return matches.sort((left, right) => right.score - left.score || left.index - right.index);
}

function searchableText(row: Row): string {
  return [row.title, row.subtitle]
    .filter((value): value is string => value !== undefined)
    .map(stripAnsi)
    .join(" ");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function projectPositions(text: string, positions: readonly number[]): number[] {
  const projected: number[] = [];
  let originalOffset = 0;
  let foldedOffset = 0;
  let matchIndex = 0;

  for (const segment of graphemes(text)) {
    const foldedLength = segment.toLocaleLowerCase().length;
    const firstMatch = matchIndex;

    while (matchIndex < positions.length && positions[matchIndex] < foldedOffset + foldedLength) {
      if (segment.length === foldedLength) {
        projected.push(originalOffset + positions[matchIndex] - foldedOffset);
      }
      matchIndex += 1;
    }

    if (matchIndex > firstMatch && segment.length !== foldedLength) {
      for (let offset = 0; offset < segment.length; offset += 1) {
        projected.push(originalOffset + offset);
      }
    }

    if (matchIndex === positions.length) {
      break;
    }
    originalOffset += segment.length;
    foldedOffset += foldedLength;
  }

  return projected;
}

function matchSubsequence(query: string, text: string): Omit<FilterMatch, "index"> | undefined {
  const queryCharacters = Array.from(query);
  const textCharacters = Array.from(text);
  let previousStates: Array<Omit<FilterMatch, "index"> | undefined> = [];

  for (let queryIndex = 0; queryIndex < queryCharacters.length; queryIndex += 1) {
    const states: Array<Omit<FilterMatch, "index"> | undefined> = [];
    let offset = 0;

    for (let textIndex = 0; textIndex < textCharacters.length; textIndex += 1) {
      const character = textCharacters[textIndex];
      const position = offset;
      offset += character.length;
      if (character !== queryCharacters[queryIndex]) {
        continue;
      }
      const positions = character.length === 2 ? [position, position + 1] : [position];

      if (queryIndex === 0) {
        states[textIndex] = {
          score:
            characterScore(textCharacters, textIndex, undefined) + Math.max(0, EARLY_MATCH_BONUS - position),
          positions
        };
        continue;
      }

      for (let previousIndex = 0; previousIndex < textIndex; previousIndex += 1) {
        const previous = previousStates[previousIndex];

        if (previous === undefined) {
          continue;
        }

        const next = {
          score: previous.score + characterScore(textCharacters, textIndex, previousIndex),
          positions: [...previous.positions, ...positions]
        };

        if (isBetterMatch(next, states[textIndex])) {
          states[textIndex] = next;
        }
      }
    }

    previousStates = states;

    if (!previousStates.some((state) => state !== undefined)) {
      return undefined;
    }
  }

  return previousStates.reduce<Omit<FilterMatch, "index"> | undefined>(
    (best, state) => (state !== undefined && isBetterMatch(state, best) ? state : best),
    undefined
  );
}

function characterScore(text: readonly string[], index: number, previousIndex: number | undefined): number {
  let score = MATCH_SCORE;

  if (previousIndex !== undefined && index === previousIndex + 1) {
    score += CONSECUTIVE_BONUS;
  }

  if (isWordStart(text, index)) {
    score += WORD_START_BONUS;
  }

  return score;
}

function isBetterMatch(
  candidate: Omit<FilterMatch, "index">,
  current: Omit<FilterMatch, "index"> | undefined
): boolean {
  if (current === undefined || candidate.score !== current.score) {
    return current === undefined || candidate.score > current.score;
  }

  for (let index = 0; index < candidate.positions.length; index += 1) {
    const position = candidate.positions[index];
    const currentPosition = current.positions[index] ?? Number.POSITIVE_INFINITY;

    if (position !== currentPosition) {
      return position < currentPosition;
    }
  }

  return false;
}

function isWordStart(text: readonly string[], index: number): boolean {
  if (index === 0) {
    return true;
  }

  const previous = text[index - 1];
  return (
    previous === " " || previous === "-" || previous === "_" || previous === "/" || previous === "."
  );
}
