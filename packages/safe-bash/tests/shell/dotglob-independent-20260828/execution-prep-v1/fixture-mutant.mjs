let count = 0;
export function probe() { count++; return 42; }
export function hits() { return count; }
