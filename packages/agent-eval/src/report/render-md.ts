import { getTheme, renderTable, withOutputFormat } from "toolcraft-design";
import type { AggregatedCell, EvalRunResult, ResultComparison } from "../types.js";
import { comparisonText, matrixRows, runRows, tableOptions } from "./format.js";

export function renderMatrixMarkdown(
  cells: readonly AggregatedCell[],
  runs: readonly EvalRunResult[] = []
): string {
  const summary = withOutputFormat("markdown", () =>
    renderTable(tableOptions(matrixRows(cells), getTheme()))
  );
  const runDetails =
    runs.length === 0 ? "" : `\n\n## Runs\n\n${runs.map(renderRunDetails).join("\n\n")}`;
  return `${summary}\n\n${cells.map(renderCellDetails).join("\n\n")}${runDetails}`;
}

export function renderRunsMarkdown(runs: readonly EvalRunResult[]): string {
  const summary = withOutputFormat("markdown", () =>
    renderTable(tableOptions(runRows(runs), getTheme()))
  );
  return `${summary}\n\n${runs.map(renderRunDetails).join("\n\n")}`;
}

export function renderComparisonMarkdown(comparisons: readonly ResultComparison[]): string {
  return `## Baseline Comparison\n\n\`\`\`text\n${comparisonText(comparisons)}\n\`\`\``;
}

function renderRunDetails(run: EvalRunResult): string {
  const metrics = (run.metrics ?? []).map((metric) => {
    const traceReferences = metric.traceReferences?.length
      ? `; trace events ${metric.traceReferences.map((reference) => `\`${reference}\``).join(", ")}`
      : "";
    const outcome =
      metric.status === "executed"
        ? `${metric.score.toFixed(1)} (${metric.passed ? "pass" : "fail"}, executed)`
        : metric.status;
    const reason = metric.reason === undefined ? "" : ` — ${metric.reason}`;
    return `- \`${metric.id}\`: ${outcome}${reason}${traceReferences}`;
  });
  const integrity = [
    ...run.cheatReport.violations.map(
      (violation) =>
        `- Violation: \`${violation.toolCall}\` accessed \`${violation.path}\` (${violation.reason}).`
    ),
    ...(run.cheatReport.uninspectable ?? []).map(
      (action) =>
        `- Risky action: \`${action.toolCall}\` ${action.operation} could not be inspected (${action.reason}).`
    )
  ];
  return [
    `### Run \`${run.runId}\``,
    `- Trace: ${run.trace?.available === true ? `available (${run.trace.eventCount ?? 0} events, ${run.trace.toolEventCount ?? 0} tool, ${run.trace.errorEventCount ?? 0} error)` : "unavailable"}.`,
    `- Execution error: ${run.error ?? "none"}.`,
    metrics.length === 0 ? "- Metrics: none." : `#### Metrics\n${metrics.join("\n")}`,
    integrity.length === 0
      ? "- Integrity evidence: none."
      : `#### Integrity Evidence\n${integrity.join("\n")}`
  ].join("\n");
}

function renderCellDetails(cell: AggregatedCell): string {
  const metrics = Object.entries(cell.metrics ?? {}).map(
    ([id, metric]) => {
      const score = metric.score === undefined ? "no executed score" : `${metric.score.mean.toFixed(1)} mean`;
      return `- \`${id}\`: ${score}; ${metric.passed} pass, ${metric.failed} fail; skipped ${metric.statuses.skipped}, error ${metric.statuses.failed}.`;
    }
  );
  const integrity = cell.integrity;
  return [
    `### Cell \`${cell.cell.eval}/${cell.cell.agent}/${cell.cell.model}\``,
    metrics.length === 0 ? "- Metrics: none." : `#### Metrics\n${metrics.join("\n")}`,
    integrity === undefined
      ? "- Integrity evidence: unavailable."
      : `- Integrity evidence: ${integrity.cheatViolations} violations; ${integrity.uninspectableActions} uninspectable risky actions; ${integrity.tracesAvailable}/${cell.repeats} traces; ${integrity.executionErrors} execution errors.`
  ].join("\n");
}
