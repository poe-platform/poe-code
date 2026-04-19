import path from "node:path";
import {
  cancel,
  confirmOrCancel,
  isCancel,
  renderMarkdown,
  select,
  text
} from "@poe-code/design-system";
import { PromptCancelledError } from "@poe-code/design-system";
import { archivePlan, deletePlan, editPlan } from "./actions.js";
import { discoverAllPlans } from "./discovery.js";
import { loadPlanPreviewMarkdown } from "./format.js";
import type { ActionFs, DiscoveryFs, PlanEntry, PlanKind } from "./types.js";

type BrowserAction = "back" | "edit" | "archive" | "delete";

export async function runPlanBrowser(options: {
  cwd: string;
  homeDir: string;
  configPath: string;
  projectConfigPath: string;
  fs: DiscoveryFs & Partial<ActionFs>;
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
  assumeYes?: boolean;
}): Promise<void> {
  const renderPlanPreview = async (
    entry: Pick<PlanEntry, "absolutePath" | "format" | "kind" | "title">
  ) => {
    const markdown = await loadPlanPreviewMarkdown(entry, options.fs);
    process.stdout.write(`${renderMarkdown(markdown).trimEnd()}\n`);
  };

  while (true) {
    const plans = await discoverAllPlans({
      cwd: options.cwd,
      homeDir: options.homeDir,
      configPath: options.configPath,
      projectConfigPath: options.projectConfigPath,
      fs: options.fs,
      kind: options.kind,
      variables: options.variables
    });

    if (plans.length === 0) {
      process.stdout.write("No plans found.\n");
      return;
    }

    if (options.assumeYes) {
      const selectedPlan = plans[0]!;
      await renderPlanPreview(selectedPlan);
      return;
    }

    const selectedPath = await select({
      message: "Select a plan",
      options: plans.map((plan) => ({
        label: text.selectLabel(path.basename(plan.path), plan.detail),
        hint: plan.typeLabel,
        value: plan.absolutePath
      }))
    });

    if (isCancel(selectedPath)) {
      return;
    }

    const selectedPlan = plans.find((plan) => plan.absolutePath === selectedPath);
    if (!selectedPlan) {
      cancel("Plan selection cancelled.");
      return;
    }

    await renderPlanPreview(selectedPlan);
    process.stdout.write("\n");

    const action = await select<BrowserAction>({
      message: "Action",
      options: [
        { label: "Back to list", value: "back" },
        { label: "Edit in $EDITOR", value: "edit" },
        { label: "Archive", value: "archive" },
        { label: "Delete", value: "delete" }
      ]
    });

    if (isCancel(action) || action === "back") {
      continue;
    }

    if (action === "edit") {
      editPlan(selectedPlan.absolutePath, {
        env: options.variables ?? process.env
      });
      continue;
    }

    if (action === "archive") {
      try {
        const confirmed = options.assumeYes || await confirmOrCancel({
          message: `Archive ${path.basename(selectedPlan.path)}?`,
          initialValue: true
        });
        if (confirmed) {
          await archivePlan(selectedPlan, options.fs as ActionFs);
        }
      } catch (error) {
        if (!(error instanceof PromptCancelledError)) {
          throw error;
        }
      }
      continue;
    }

    try {
      const confirmed = options.assumeYes || await confirmOrCancel({
        message: `Permanently delete ${path.basename(selectedPlan.path)}?`,
        initialValue: true
      });
      if (confirmed) {
        await deletePlan(selectedPlan, options.fs as ActionFs);
      }
    } catch (error) {
      if (!(error instanceof PromptCancelledError)) {
        throw error;
      }
    }
  }
}
