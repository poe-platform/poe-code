/** Released Gnumeric/Excel fill-pattern correspondence (MS-XLS FillPattern). */
export const biffFillPatterns: readonly number[] = [0, 1, 3, 2, 4, 7, 8, 10, 9, 11, 12, 13, 14, 15, 16, 17, 18, 5, 6];
/** The final six Gnumeric patterns use the native writer's nearest Excel fallback. */
export const gnumericFillPatterns: readonly number[] = [
  ...biffFillPatterns.map((_, shade) => biffFillPatterns.indexOf(shade)), 12, 5, 4, 4, 3, 1
];
