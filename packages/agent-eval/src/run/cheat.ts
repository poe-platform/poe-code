import os from "node:os";
import path from "node:path";

import type { CheatReport } from "../types.js";
import type { TraceToolEvent } from "./trace/types.js";

type CheatViolation = CheatReport["violations"][number];
type UninspectableAction = NonNullable<CheatReport["uninspectable"]>[number];
type ObservedUninspectableAction = UninspectableAction & { evidenceKey: string };

export class CheatFilter {
  private readonly cloneDir: string;
  private readonly allowedPaths: readonly string[];
  private readonly violations: CheatViolation[] = [];
  private readonly uninspectable: ObservedUninspectableAction[] = [];
  private readonly observedEvidence = new Set<string>();

  constructor(input: { cloneDir: string; allowedPaths?: readonly string[] }) {
    this.cloneDir = path.resolve(input.cloneDir);
    this.allowedPaths = defaultAllowedPaths()
      .concat(input.allowedPaths ?? [])
      .map((allowedPath) => path.resolve(allowedPath));
  }

  onEvent(event: TraceToolEvent): void {
    if (!isObservedOperation(event.operation) || !canContainNewEvidence(event)) {
      return;
    }

    if (event.paths.length > 0) {
      this.clearResolvedMissingPath(event);
    }

    if (
      event.inspection?.status === "uninspectable" &&
      isUninspectableOperation(event.operation) &&
      this.recordEvidence(event, `inspection:${event.inspection.reason}`)
    ) {
      this.uninspectable.push({
        toolCall: event.name,
        operation: event.operation,
        reason: event.inspection.reason,
        evidenceKey: this.evidenceKey(event, `inspection:${event.inspection.reason}`)
      });
    }

    for (const eventPath of event.paths) {
      const resolvedPath = resolveAgainstClone(this.cloneDir, eventPath);
      if (isUnderAny(resolvedPath, [this.cloneDir, ...this.allowedPaths])) {
        continue;
      }
      if (!this.recordEvidence(event, `path:${resolvedPath}`)) {
        continue;
      }

      this.violations.push({
        path: resolvedPath,
        toolCall: event.name,
        reason: "outside-clone"
      });
    }
  }

  private recordEvidence(event: TraceToolEvent, evidence: string): boolean {
    const evidenceKey = this.evidenceKey(event, evidence);
    if (this.observedEvidence.has(evidenceKey)) {
      return false;
    }
    this.observedEvidence.add(evidenceKey);
    return true;
  }

  private clearResolvedMissingPath(event: TraceToolEvent): void {
    const missingPathKey = this.evidenceKey(event, "inspection:missing-path");
    if (!this.observedEvidence.delete(missingPathKey)) {
      return;
    }
    const index = this.uninspectable.findIndex((action) => action.evidenceKey === missingPathKey);
    if (index !== -1) {
      this.uninspectable.splice(index, 1);
    }
  }

  private evidenceKey(event: TraceToolEvent, evidence: string): string {
    return `${event.id ?? `sequence:${event.sequence}`}:${evidence}`;
  }

  report(): CheatReport {
    return {
      cheated: this.violations.length > 0,
      violations: this.violations.slice(),
      ...(this.uninspectable.length === 0
        ? {}
        : {
            uninspectable: this.uninspectable.map(
              ({ evidenceKey: _evidenceKey, ...action }) => action
            )
          })
    };
  }
}

function canContainNewEvidence(event: TraceToolEvent): boolean {
  return event.id !== undefined || event.phase === "start";
}

function defaultAllowedPaths(): string[] {
  const allowedPaths = [
    os.tmpdir(),
    path.join(os.homedir(), ".cache"),
    "/usr/bin",
    "/usr/local/bin",
    "/bin"
  ];

  if (process.platform === "darwin") {
    allowedPaths.push("/opt/homebrew/bin");
  }

  return allowedPaths;
}

function isObservedOperation(operation: TraceToolEvent["operation"]): boolean {
  return (
    operation === "read" ||
    operation === "search" ||
    operation === "exec" ||
    operation === "edit" ||
    operation === "write" ||
    operation === "mcp"
  );
}

function isUninspectableOperation(
  operation: TraceToolEvent["operation"]
): operation is Exclude<TraceToolEvent["operation"], "other"> {
  return isObservedOperation(operation);
}

function resolveAgainstClone(cloneDir: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }
  return path.resolve(cloneDir, targetPath);
}

function isUnderAny(targetPath: string, roots: readonly string[]): boolean {
  return roots.some((root) => isUnderPath(targetPath, root));
}

function isUnderPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
