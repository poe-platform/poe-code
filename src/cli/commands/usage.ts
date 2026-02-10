import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { ApiError } from "../errors.js";
import { confirm, isCancel, getTheme, widths, typography, renderTable } from "@poe-code/design-system";

async function executeBalance(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    "usage:balance"
  );

  resources.logger.intro("usage balance");

  try {
    const apiKey = await container.options.resolveApiKey({ dryRun: flags.dryRun });

    if (flags.dryRun) {
      resources.logger.dryRun(
        "Dry run: would fetch usage balance from Poe API."
      );
      return;
    }

    const response = await container.httpClient(
      `${container.env.poeBaseUrl}/usage/current_balance`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new ApiError(
        `Failed to fetch usage balance (HTTP ${response.status})`,
        {
          httpStatus: response.status,
          endpoint: "/usage/current_balance"
        }
      );
    }

    const data = (await response.json()) as {
      current_point_balance: number;
    };
    const theme = getTheme();
    const formatted = data.current_point_balance.toLocaleString("en-US");
    const styledBalance = typography.bold(theme.accent(formatted));

    resources.logger.info(`Current balance: ${styledBalance} points`);
    resources.logger.feedback(
      "Need more points?",
      "https://poe.com/api/keys"
    );
  } catch (error) {
    if (error instanceof Error) {
      resources.logger.logException(error, "usage balance", {
        operation: "fetch-balance"
      });
    }
    throw error;
  }
}

export function registerUsageCommand(
  program: Command,
  container: CliContainer
): void {
  const usage = program
    .command("usage")
    .description("Check Poe API usage information.")
    .action(async () => {
      await executeBalance(program, container);
    });

  usage
    .command("balance")
    .description("Display current point balance.")
    .action(async () => {
      await executeBalance(program, container);
    });

  usage
    .command("list")
    .description("Display usage history.")
    .option("--filter <model>", "Filter results by model name")
    .option("--pages <count>", "Number of pages to load automatically", parseInt)
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "usage:list"
      );
      const commandOptions = this.opts<{ filter?: string; pages?: number }>();

      resources.logger.intro("usage list");

      try {
        const apiKey = await container.options.resolveApiKey({ dryRun: flags.dryRun });

        if (flags.dryRun) {
          resources.logger.dryRun(
            "Dry run: would fetch usage history from Poe API."
          );
          return;
        }

        const theme = getTheme();
        const filterTerm = commandOptions.filter;
        const tzAbbr = Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
          .formatToParts(new Date())
          .find((p) => p.type === "timeZoneName")?.value ?? "local";
        const dateTitle = `Date [${tzAbbr}]`;
        const dateWidth = Math.max(16, dateTitle.length);
        const costTitle = "Cost";
        const costWidth = 24;
        const tableChrome = 10;
        const modelMaxWidth = widths.maxLine - dateWidth - costWidth - tableChrome;
        const tableColumns = [
          { name: "Date", title: dateTitle, alignment: "left" as const, maxLen: dateWidth },
          { name: "Model", title: "Model", alignment: "left" as const, maxLen: modelMaxWidth },
          { name: "Cost", title: costTitle, alignment: "right" as const, maxLen: costWidth }
        ];

        const formatEntry = (entry: {
          creation_time: number;
          bot_name: string;
          cost_usd: string;
          cost_points: number;
        }): Record<string, string> => {
          const date = new Date(entry.creation_time / 1000);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          const hours = String(date.getHours()).padStart(2, "0");
          const minutes = String(date.getMinutes()).padStart(2, "0");
          const formatted = `${year}-${month}-${day} ${hours}:${minutes}`;
          const modelName = entry.bot_name.length > modelMaxWidth
            ? entry.bot_name.slice(0, modelMaxWidth - 1) + "\u2026"
            : entry.bot_name;
          const costText = `$${entry.cost_usd} (${entry.cost_points} points)`;
          return {
            Date: theme.muted(formatted),
            Model: theme.accent(modelName),
            Cost: entry.cost_points < 0
              ? theme.error(costText)
              : theme.success(costText)
          };
        };

        let totalFetched = 0;
        let totalFiltered = 0;
        let startingAfter: string | undefined;
        let pagesLoaded = 0;
        const maxPages = commandOptions.pages;

        while (true) {
          let url = `${container.env.poeBaseUrl}/usage/points_history?limit=20`;
          if (startingAfter) {
            url += `&starting_after=${startingAfter}`;
          }

          const response = await container.httpClient(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey}`
            }
          });

          if (!response.ok) {
            throw new ApiError(
              `Failed to fetch usage history (HTTP ${response.status})`,
              {
                httpStatus: response.status,
                endpoint: "/usage/points_history"
              }
            );
          }

          const result = (await response.json()) as {
            has_more: boolean;
            data: Array<{
              query_id: string;
              creation_time: number;
              bot_name: string;
              cost_usd: string;
              cost_points: number;
            }>;
          };

          pagesLoaded++;
          totalFetched += result.data.length;

          const pageEntries = filterTerm
            ? result.data.filter((entry) =>
                entry.bot_name.toLowerCase().includes(filterTerm.toLowerCase())
              )
            : result.data;

          totalFiltered += pageEntries.length;

          if (pageEntries.length > 0) {
            const rows = pageEntries.map(formatEntry);
            resources.logger.info(renderTable({ theme, columns: tableColumns, rows }));
          }

          if (!result.has_more || result.data.length === 0) {
            break;
          }

          if (maxPages !== undefined && pagesLoaded >= maxPages) {
            break;
          }

          startingAfter = result.data[result.data.length - 1].query_id;

          if (maxPages === undefined) {
            const shouldContinue = await confirm({ message: "Load more?" });
            if (isCancel(shouldContinue) || !shouldContinue) {
              break;
            }
          }
        }

        if (totalFetched === 0) {
          resources.logger.info("No usage history found.");
        } else if (filterTerm && totalFiltered === 0) {
          resources.logger.info(
            `No entries match "${filterTerm}".`
          );
        } else if (filterTerm && totalFiltered > 0) {
          resources.logger.info(
            `Showing entries matching "${filterTerm}".`
          );
        }
      } catch (error) {
        if (error instanceof Error) {
          resources.logger.logException(error, "usage list", {
            operation: "fetch-history"
          });
        }
        throw error;
      }
    });
}
