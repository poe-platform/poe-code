export type DiagnosticSeverity = "error" | "warn";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  location?: string;
}

export const DIAGNOSTIC_CODES = {
  unmappedEndpoint: "TOOLCRAFT_OPENAPI_001",
  duplicateMethodPath: "TOOLCRAFT_OPENAPI_002",
  unknownPaginationScheme: "TOOLCRAFT_OPENAPI_003",
  specDrift: "TOOLCRAFT_OPENAPI_004",
  reservedMethodName: "TOOLCRAFT_OPENAPI_005",
  invalidEdition: "TOOLCRAFT_OPENAPI_006",
  invalidConfig: "TOOLCRAFT_OPENAPI_007"
} as const;

export function createDiagnostic(args: Diagnostic): Diagnostic {
  return args;
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.location === undefined ? "" : ` ${diagnostic.location}`;
  return `${diagnostic.code} ${diagnostic.severity}${location}: ${diagnostic.message}`;
}

export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `${formatDiagnostic(diagnostic)}\n`).join("");
}
