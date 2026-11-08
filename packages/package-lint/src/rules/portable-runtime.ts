import type { Rule } from "../model.js";

export const portableRuntime: Rule = {
  id: "portable-runtime",
  requiresBuild: true,
  run(_model, build) {
    return (build?.portableRuntime ?? []).map(issue => ({
      rule: this.id,
      package: issue.package,
      severity: "error" as const,
      via: issue.file,
      detail: { reason: issue.reason, ...(issue.specifier === undefined ? {} : { specifier: issue.specifier }) },
      message: `Portable runtime ${issue.reason}: ${issue.specifier ?? "Buffer"}`,
      fix: "Use portable JavaScript and @poe-code/safe-fs; keep Node host adapters behind blocked portable exports and resolve every runtime dependency."
    }));
  }
};
