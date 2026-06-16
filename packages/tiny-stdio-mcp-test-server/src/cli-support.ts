export const SERVE_TOOL_NAMES = ["encrypt", "word-of-the-day"] as const;

export type ServeToolName = typeof SERVE_TOOL_NAMES[number];

export function isServeToolName(value: string): value is ServeToolName {
  return SERVE_TOOL_NAMES.includes(value as ServeToolName);
}

function parseSpawnCount(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") {
    return 0;
  }

  for (const character of trimmed) {
    if (character < "0" || character > "9") {
      throw new Error("TOOLCRAFT_TEST_SPAWN_COUNT_FILE must contain a non-negative integer");
    }
  }

  const count = Number(trimmed);
  if (!Number.isSafeInteger(count)) {
    throw new Error("TOOLCRAFT_TEST_SPAWN_COUNT_FILE must contain a non-negative integer");
  }
  return count;
}

export function getNextSpawnCount(currentValue: string | undefined): number {
  return (currentValue === undefined ? 0 : parseSpawnCount(currentValue)) + 1;
}
