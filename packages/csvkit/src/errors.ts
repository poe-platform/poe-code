/** Reference diagnostics and honest capability/qualification failures are distinct. */
export class CsvkitDiagnostic extends Error {
  constructor(message: string, readonly status: number = 1) { super(message); }
}
export class CsvkitBlocked extends CsvkitDiagnostic {
  constructor(message: string) { super(`csvkit: unsupported or unqualified: ${message}`, 78); }
}
export class CsvkitOutputBudgetError extends CsvkitBlocked {
  constructor() { super("output byte budget exceeded"); }
}
export class CsvkitWorkBudgetError extends CsvkitBlocked {
  constructor() { super("work budget exceeded"); }
}
/** Owned cooperative cleanup failed, rather than an operation throwing. */
export class CsvkitCleanupError extends AggregateError {
  constructor(errors: readonly unknown[], message: string) { super(errors, message); this.name = "CsvkitCleanupError"; }
}
