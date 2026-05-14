import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runExplorer } from "./index.js";
import type { Action, Detail, DetailCtx, ExplorerConfig, Row } from "./state.js";

type ExplorerDemoMode = "single-detail-mode" | "list-detail-mode";

export interface ExplorerDemoOptions {
  mode: ExplorerDemoMode;
  slowDetail: boolean;
}

export interface BuildExplorerDemoConfigOptions extends ExplorerDemoOptions {
  onReorder?: (orderedIds: string[]) => void | Promise<void>;
}

const detailDelayMs = 500;
const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

const singleDetailRows: Row[] = [
  {
    id: "configure-commands",
    title: "Configure commands",
    subtitle: "Provider config mutation flow",
    badge: { text: "ready", tone: "success" },
    group: "Planning"
  },
  {
    id: "provider-boilerplate",
    title: "Provider boilerplate audit",
    subtitle: "Keep providers declarative and minimal",
    badge: { text: "review", tone: "warning" },
    group: "Planning"
  },
  {
    id: "markdown-reader",
    title: "Markdown reader",
    subtitle: "Terminal-rendered plan preview",
    badge: { text: "done", tone: "muted" },
    group: "Docs"
  },
  {
    id: "design-system-prompts",
    title: "Design system prompts",
    subtitle: "Prompt primitives owned by the package",
    badge: { text: "active", tone: "info" },
    group: "UI"
  }
];

const singleDetailMarkdown: Record<string, string> = {
  "configure-commands": [
    "# Configure commands",
    "",
    "Provider configuration should be derived from declarative provider config.",
    "",
    "- Parse existing files with structured parsers.",
    "- Deep merge edits instead of replacing user-owned configuration.",
    "- Keep CLI and SDK arguments in parity."
  ].join("\n"),
  "provider-boilerplate": [
    "# Provider boilerplate audit",
    "",
    "Adding a provider should mean adding one provider file. Everything else should come from the provider config.",
    "",
    "Avoid provider-specific branches in shared code paths."
  ].join("\n"),
  "markdown-reader": [
    "# Markdown reader",
    "",
    "Render markdown plans with stable wrapping and predictable terminal styling.",
    "",
    "The reader is a display surface, not a planning store."
  ].join("\n"),
  "design-system-prompts": [
    "# Design system prompts",
    "",
    "Prompt primitives belong in the design-system package so CLI surfaces share one style.",
    "",
    "Direct use of unrelated prompt libraries should stay out of consumers."
  ].join("\n")
};

const reviewRows: Row[] = [
  {
    id: "pr-1842",
    title: "PR #1842 provider config parser",
    subtitle: "3 unresolved comments by reviewbot",
    badge: { text: "changes", tone: "warning" },
    group: "Review queue"
  },
  {
    id: "pr-1847",
    title: "PR #1847 explorer TUI library",
    subtitle: "2 comments, one destructive flow question",
    badge: { text: "ready", tone: "success" },
    group: "Review queue"
  },
  {
    id: "pr-1851",
    title: "PR #1851 markdown QA checklist",
    subtitle: "1 docs-only note",
    badge: { text: "docs", tone: "info" },
    group: "Review queue"
  }
];

const reviewComments: Record<string, Array<{
  id: string;
  title: string;
  subtitle: string;
  body: string;
  tone?: "success" | "warning" | "error" | "info" | "muted";
}>> = {
  "pr-1842": [
    {
      id: "pr-1842-comment-1",
      title: "Review: provider registry",
      subtitle: "packages/providers/src/registry.ts:42",
      body: "The provider data is already present in config. Derive the registry entry instead of repeating provider names here.",
      tone: "warning"
    },
    {
      id: "pr-1842-comment-2",
      title: "Review: config merge",
      subtitle: "packages/config-mutations/src/apply.ts:88",
      body: "This should deep merge the parsed structure so user-owned fields remain intact.",
      tone: "error"
    },
    {
      id: "pr-1842-comment-3",
      title: "Review: parser coverage",
      subtitle: "packages/config-mutations/src/apply.test.ts:131",
      body: "Add a fixture that proves comments and unknown keys survive the update path.",
      tone: "info"
    }
  ],
  "pr-1847": [
    {
      id: "pr-1847-comment-1",
      title: "Review: detail loading",
      subtitle: "packages/design-system/src/explorer/jobs.ts:19",
      body: "The 150 ms loading threshold is the right behavior. This demo should make that visible with --slow-detail.",
      tone: "success"
    },
    {
      id: "pr-1847-comment-2",
      title: "Review: destructive confirm",
      subtitle: "packages/design-system/src/explorer/reducer.ts:435",
      body: "Confirm modal behavior should be reachable from manual QA with a simple keybinding.",
      tone: "warning"
    }
  ],
  "pr-1851": [
    {
      id: "pr-1851-comment-1",
      title: "Review: QA format",
      subtitle: "docs/qa/explorer-tui-library.md",
      body: "Keep this as a markdown checklist. Do not convert manual QA into a script.",
      tone: "info"
    }
  ]
};

export function parseExplorerDemoOptions(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): ExplorerDemoOptions {
  let mode = parseMode(env.EXPLORER_DEMO_MODE) ?? "single-detail-mode";
  let slowDetail = isTruthy(env.EXPLORER_DEMO_SLOW_DETAIL);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--slow-detail") {
      slowDetail = true;
      continue;
    }

    if (arg === "--single-detail-mode") {
      mode = "single-detail-mode";
      continue;
    }

    if (arg === "--list-detail-mode") {
      mode = "list-detail-mode";
      continue;
    }

    if (arg === "--mode") {
      const next = argv[index + 1];
      const parsed = parseMode(next);
      if (parsed === undefined) {
        throw new Error(`Unsupported explorer demo mode: ${next ?? ""}`);
      }
      mode = parsed;
      index += 1;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const parsed = parseMode(arg.slice("--mode=".length));
      if (parsed === undefined) {
        throw new Error(`Unsupported explorer demo mode: ${arg.slice("--mode=".length)}`);
      }
      mode = parsed;
    }
  }

  return { mode, slowDetail };
}

export function buildExplorerDemoConfig(
  options: BuildExplorerDemoConfigOptions
): ExplorerConfig<void> {
  const rows = options.mode === "single-detail-mode" ? singleDetailRows : reviewRows;
  const detail = options.mode === "single-detail-mode"
    ? buildSingleDetail(options.slowDetail)
    : buildReviewDetail(options.slowDetail);

  return {
    title: `Explorer Demo - ${options.mode}`,
    rows: async () => rows,
    detail,
    actions: demoActions(),
    reorder: {
      onReorder: options.onReorder ?? (() => undefined)
    },
    multiSelect: true,
    emptyHint: "No rows match the current filter"
  };
}

export async function main(): Promise<void> {
  const options = parseExplorerDemoOptions();
  await runExplorer(buildExplorerDemoConfig(options));
}

function buildSingleDetail(slowDetail: boolean): Detail<void> {
  return {
    items: async (row, ctx) => {
      await delayDetailIfNeeded(slowDetail, ctx);
      const markdown = singleDetailMarkdown[row.id] ?? `# ${row.title}\n\nNo demo detail is available.`;

      return [{ id: row.id, render: () => markdown }];
    }
  };
}

function buildReviewDetail(slowDetail: boolean): Detail<void> {
  return {
    items: async (row, ctx) => {
      await delayDetailIfNeeded(slowDetail, ctx);
      const comments = reviewComments[row.id] ?? [];
      return comments.map((comment) => ({
        id: comment.id,
        title: comment.title,
        subtitle: comment.subtitle,
        badge: { text: "comment", tone: comment.tone },
        render: () => comment.body
      }));
    },
    actions: [
      {
        id: "resolve-comment",
        label: "Resolve comment",
        key: "x",
        showInFooter: true,
        handler: (ctx) => {
          ctx.toast(`Resolved ${ctx.item?.title ?? ctx.row.title}`, "success");
        }
      }
    ]
  };
}

function demoActions(): Action<void>[] {
  return [
    {
      id: "open",
      label: "Open",
      primary: true,
      showInFooter: true,
      handler: (ctx) => {
        ctx.toast(`Opened ${ctx.row.title}`, "info");
      }
    },
    {
      id: "refresh",
      label: "Refresh",
      key: "r",
      showInFooter: true,
      handler: async (ctx) => {
        await ctx.refresh();
        ctx.toast("Rows refreshed", "success");
      }
    },
    {
      id: "archive",
      label: () => "Archive selected",
      key: "a",
      destructive: true,
      showInFooter: true,
      handler: (ctx) => {
        ctx.toast(`Archived ${ctx.rows.length} row${ctx.rows.length === 1 ? "" : "s"}`, "warning");
      }
    }
  ];
}

async function delayDetailIfNeeded(slowDetail: boolean, ctx: DetailCtx): Promise<void> {
  if (!slowDetail) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, detailDelayMs);
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function parseMode(value: string | undefined): ExplorerDemoMode | undefined {
  if (value === "single-detail-mode" || value === "list-detail-mode") {
    return value;
  }

  return undefined;
}

function isTruthy(value: string | undefined): boolean {
  return value === undefined ? false : truthyEnvValues.has(value.toLowerCase());
}

const entry = process.argv[1];
const isMain = typeof entry === "string" && path.resolve(entry) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
