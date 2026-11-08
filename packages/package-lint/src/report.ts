import { color, symbols, text } from "toolcraft-design";
import type { LintResult, Violation } from "./model.js";

const RULE_COLUMN = 40;

function padRuleId(id: string): string {
  return id.length >= RULE_COLUMN ? id : id + " ".repeat(RULE_COLUMN - id.length);
}

function violationBlock(violation: Violation): string {
  const symbol =
    violation.severity === "warning" ? color.yellow(symbols.warning) : symbols.errorResolved;
  const via = violation.via ? color.gray(` (${violation.via})`) : "";
  return (
    `    ${symbol} ${color.bold(violation.package)}${via}\n` +
    `        ${violation.message}\n` +
    `        ${color.gray(`↳ fix: ${violation.fix}`)}`
  );
}

function groupByRule(violations: Violation[]): Map<string, Violation[]> {
  const byRule = new Map<string, Violation[]>();
  for (const violation of violations) {
    const list = byRule.get(violation.rule) ?? [];
    list.push(violation);
    byRule.set(violation.rule, list);
  }
  return byRule;
}

export function formatReport(result: LintResult, opts: { json: boolean; quiet: boolean }): string {
  if (opts.json) {
    return JSON.stringify(
      {
        summary: result.summary,
        evaluated: result.evaluated,
        violations: result.violations,
        skipped: result.skipped
      },
      null,
      2
    );
  }

  const byRule = groupByRule(result.violations);
  const lines: string[] = [
    text.muted(
      `package-lint · ${result.summary.rules} rules · ${result.summary.packages} packages`
    ),
    ""
  ];

  let failedRules = 0;
  for (const ruleId of result.evaluated) {
    if (!byRule.has(ruleId) && !result.skipped.includes(ruleId) && opts.quiet) continue;

    if (result.skipped.includes(ruleId)) {
      lines.push(`${padRuleId(ruleId)} ${color.gray("– skipped (needs build)")}`);
      continue;
    }

    const violations = byRule.get(ruleId) ?? [];
    if (violations.length === 0) {
      lines.push(`${padRuleId(ruleId)} ${color.green("✓")}`);
      continue;
    }

    failedRules += 1;
    lines.push(
      `${symbols.errorResolved} ${color.bold(ruleId)}  ${color.gray(`(${violations.length})`)}`
    );
    for (const violation of violations) lines.push(violationBlock(violation));
    lines.push("");
  }

  const errors = result.violations.filter((v) => v.severity === "error").length;
  const warnings = result.violations.length - errors;
  if (result.summary.ok) {
    if (result.skipped.length > 0) {
      const passed = result.summary.rules - result.skipped.length;
      lines.push(color.green(`✓ ${passed} rules passed · ${result.skipped.length} skipped`));
    } else {
      lines.push(color.green(`✓ all ${result.summary.rules} rules passed`));
    }
  } else {
    const summary = `${failedRules} rules failed · ${result.violations.length} violations`;
    lines.push(
      warnings > 0
        ? `${text.error(summary)} ${color.gray(`(${warnings} warnings)`)}`
        : text.error(summary)
    );
  }

  return lines.join("\n");
}
