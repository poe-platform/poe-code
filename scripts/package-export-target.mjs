export function selectConditionalTarget(target, conditions) {
  if (target === null || typeof target === "string") return target;
  if (!target || typeof target !== "object" || Array.isArray(target)) return undefined;
  for (const [condition, value] of Object.entries(target)) {
    if (!conditions.has(condition)) continue;
    const selected = selectConditionalTarget(value, conditions);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

