let count = 0;
export function probe() { count++; return 41; }
export function hits() { return count; }
