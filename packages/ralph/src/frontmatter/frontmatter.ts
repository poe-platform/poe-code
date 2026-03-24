import { stringify, parse } from "yaml";

export type RalphPlanStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "overbake_abort"
  | "cancelled";

export interface RalphFrontmatter {
  status: RalphPlanStatus;
  iteration: number;
}

const FENCE = "---";

export function parseFrontmatter(content: string): {
  data: RalphFrontmatter;
  body: string;
} {
  const defaults: RalphFrontmatter = { status: "pending", iteration: 0 };

  if (!content.startsWith(`${FENCE}\n`)) {
    return { data: defaults, body: content };
  }

  const closingIndex = content.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (closingIndex === -1) {
    return { data: defaults, body: content };
  }

  const yamlBlock = content.slice(FENCE.length + 1, closingIndex);
  const body = content.slice(closingIndex + FENCE.length + 2);
  const parsed = parse(yamlBlock) as Record<string, unknown> | null;

  return {
    data: {
      status: isValidStatus(parsed?.status) ? parsed.status : defaults.status,
      iteration:
        typeof parsed?.iteration === "number"
          ? parsed.iteration
          : defaults.iteration
    },
    body
  };
}

export function writeFrontmatter(
  data: RalphFrontmatter,
  body: string
): string {
  const yaml = stringify(data).trimEnd();
  return `${FENCE}\n${yaml}\n${FENCE}\n${body}`;
}

function isValidStatus(value: unknown): value is RalphPlanStatus {
  return (
    typeof value === "string" &&
    ["pending", "in_progress", "completed", "overbake_abort", "cancelled"].includes(
      value
    )
  );
}
