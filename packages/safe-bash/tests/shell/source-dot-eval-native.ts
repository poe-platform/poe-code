
import type { CurrentShellCase } from "./source-dot-eval-cases.js";

export function fixtureCase(fixture: CurrentShellCase) {
  return { ...fixture, files: Object.fromEntries(Object.entries(fixture.files).map(([name, text]) => [name, { text, mode: 0o644 }])) };
}
