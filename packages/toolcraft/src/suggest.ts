export function suggest(
  input: string,
  candidates: readonly string[],
  opts: { max?: number; threshold?: number } = {}
): string[] {
  if (input.length === 0) {
    return [];
  }

  const max = opts.max ?? 3;
  const threshold = opts.threshold ?? Math.max(1, Math.floor(input.length / 4));

  return candidates
    .map((candidate) => ({
      candidate,
      distance: damerauLevenshtein(input, candidate)
    }))
    .filter(({ distance }) => distance <= threshold)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.candidate.localeCompare(right.candidate);
    })
    .slice(0, max)
    .map(({ candidate }) => candidate);
}

function damerauLevenshtein(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0)
  );

  for (let row = 0; row <= left.length; row += 1) {
    distances[row]![0] = row;
  }

  for (let column = 0; column <= right.length; column += 1) {
    distances[0]![column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      const deletion = distances[row - 1]![column]! + 1;
      const insertion = distances[row]![column - 1]! + 1;
      const substitution = distances[row - 1]![column - 1]! + substitutionCost;

      distances[row]![column] = Math.min(deletion, insertion, substitution);

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distances[row]![column] = Math.min(
          distances[row]![column]!,
          distances[row - 2]![column - 2]! + 1
        );
      }
    }
  }

  return distances[left.length]![right.length]!;
}
