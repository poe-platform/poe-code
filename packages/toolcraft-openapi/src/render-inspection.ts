import { getTheme, renderCatalog, resolveOutputFormat, type CatalogGroup } from "toolcraft-design";
import type { OpenApiInspectionOperation, OpenApiInspectionReport } from "./inspect.js";

const LARGE_API_OPERATION_THRESHOLD = 50;

export function renderOpenApiInspection(report: OpenApiInspectionReport): string {
  if (resolveOutputFormat() === "json") {
    return JSON.stringify(report, null, 2);
  }

  return renderCatalog({
    theme: getTheme(),
    title: report.title ?? "OpenAPI",
    ...(report.version === undefined ? {} : { subtitle: `v${report.version}` }),
    metrics: [
      {
        label: "compatible",
        value: `${Math.round((report.supportedCount / Math.max(report.operationCount, 1)) * 100)}%`,
        tone: report.unsupportedCount === 0 ? "success" : "accent"
      },
      { label: pluralize("operation", report.operationCount), value: report.operationCount },
      { label: "supported", value: report.supportedCount, tone: "success" },
      {
        label: "unsupported",
        value: report.unsupportedCount,
        tone: report.unsupportedCount === 0 ? "muted" : "warning"
      }
    ],
    groups:
      report.operationCount > LARGE_API_OPERATION_THRESHOLD
        ? summarizeOperationGroups(report.operations)
        : groupOperations(report.operations)
  });
}

function groupOperations(operations: OpenApiInspectionOperation[]): CatalogGroup[] {
  return collectOperationGroups(operations).map(([title, groupOperations]) => ({
    title,
    items: groupOperations.map((operation) => ({
      label: operation.status === "supported" ? "ready" : "blocked",
      value: `${operation.method} ${operation.path}`,
      detail:
        operation.status === "supported"
          ? (operation.commandPath ?? operation.operationId)
          : (operation.reason ?? operation.operationId),
      tone: operation.status === "supported" ? ("success" as const) : ("warning" as const)
    }))
  }));
}

function summarizeOperationGroups(operations: OpenApiInspectionOperation[]): CatalogGroup[] {
  const groups = collectOperationGroups(operations);
  const incompatibilities = summarizeIncompatibilities(operations);
  const blockedGroups = groups
    .filter(([, groupOperations]) =>
      groupOperations.some((operation) => operation.status === "unsupported")
    )
    .sort(([leftTitle, leftOperations], [rightTitle, rightOperations]) => {
      const blockedCountDifference =
        countUnsupported(rightOperations) - countUnsupported(leftOperations);
      return blockedCountDifference || leftTitle.localeCompare(rightTitle);
    });
  const resourceItems =
    blockedGroups.length === 0
      ? [
          {
            label: `${operations.length}/${operations.length}`,
            value: "all resources",
            detail: `${groups.length} groups compatible`,
            tone: "success" as const
          }
        ]
      : blockedGroups.map(([title, groupOperations]) => {
          const supportedCount = groupOperations.filter(
            (operation) => operation.status === "supported"
          ).length;
          const unsupportedCount = countUnsupported(groupOperations);
          const firstUnsupported = groupOperations.find(
            (operation) => operation.status === "unsupported"
          );

          return {
            label: `${supportedCount}/${groupOperations.length}`,
            value: title,
            detail: `${unsupportedCount} unsupported · ${firstUnsupported?.reason ?? "inspect JSON output"}`,
            tone: "warning" as const
          };
        });

  return [
    {
      title: "resources",
      description:
        blockedGroups.length === 0
          ? "Every generated command group is compatible."
          : `Showing ${blockedGroups.length} of ${groups.length} command groups that need attention. Use --output-format json for every route.`,
      items: resourceItems
    },
    ...(incompatibilities.length === 0
      ? []
      : [
          {
            title: "top incompatibilities",
            description: "First failing compatibility check per blocked route.",
            items: incompatibilities.map(([reason, count]) => ({
              label: `${count} ${pluralize("route", count)}`,
              value: reason,
              tone: "warning" as const
            }))
          }
        ])
  ];
}

function countUnsupported(operations: OpenApiInspectionOperation[]): number {
  return operations.filter((operation) => operation.status === "unsupported").length;
}

function summarizeIncompatibilities(
  operations: OpenApiInspectionOperation[]
): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const operation of operations) {
    if (operation.status !== "unsupported" || operation.reason === undefined) {
      continue;
    }

    const normalizedReason = operation.reason.replace(/^Operation "[^"]+" /, "Operation ");
    counts.set(normalizedReason, (counts.get(normalizedReason) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([leftReason, leftCount], [rightReason, rightCount]) =>
      rightCount - leftCount || leftReason.localeCompare(rightReason)
    )
    .slice(0, 5);
}

function collectOperationGroups(
  operations: OpenApiInspectionOperation[]
): Array<[string, OpenApiInspectionOperation[]]> {
  const groups = new Map<string, OpenApiInspectionOperation[]>();

  for (const operation of operations) {
    const groupName = getGroupName(operation);
    const group = groups.get(groupName) ?? [];
    group.push(operation);
    groups.set(groupName, group);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function getGroupName(operation: OpenApiInspectionOperation): string {
  if (operation.commandPath !== undefined) {
    return operation.commandPath.split(" ")[0] ?? "root";
  }

  return (
    operation.path.split("/").find((segment) => segment.length > 0 && !segment.startsWith("{")) ??
    "root"
  );
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
