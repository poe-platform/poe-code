import { InvalidArgumentError, type Command } from "commander";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { ApiError, OperationCancelledError } from "../errors.js";
import {
  confirm,
  isCancel,
  getTheme,
  widths,
  typography,
  renderTable,
  withSpinner
} from "toolcraft-design";
import type { ScopedLogger } from "../logger.js";

export interface BalanceResponse {
  current_point_balance: number;
  plan_points_balance: number;
  addon_point_balance: number;
  plan_balance_usd: string;
  addon_balance_usd: string;
  total_balance_usd: string;
  points_cycle_start_time: number;
  next_daily_grant_time: number;
  next_monthly_grant_time: number;
  next_daily_grant_amount: number;
  next_monthly_grant_amount: number;
  auto_recharge: {
    enabled: boolean;
    status: string;
    threshold_points: number;
    threshold_usd: string;
    refill_points: number;
    refill_usd: string;
    last_recharge_failure_time: number | null;
  };
}

function parsePositivePageCount(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}

function formatUsdAndPoints(usd: string, points: number): string {
  return `$${usd} (${points.toLocaleString("en-US")} pts)`;
}

function formatGrantDate(microseconds: number): string {
  const date = new Date(microseconds / 1000);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function renderBalanceDisplay(data: BalanceResponse, logger: ScopedLogger): void {
  const theme = getTheme();

  const totalLine = typography.bold(
    theme.accent(formatUsdAndPoints(data.total_balance_usd, data.current_point_balance))
  );
  const planLine = theme.muted(
    `Plan:   ${formatUsdAndPoints(data.plan_balance_usd, data.plan_points_balance)}`
  );
  const addonLabel = data.auto_recharge.enabled ? "Add-on (auto)" : "Add-on";
  const addonLine = theme.muted(
    `${addonLabel}: ${formatUsdAndPoints(data.addon_balance_usd, data.addon_point_balance)}`
  );

  logger.info(`Balance: ${totalLine}\n   ◇  ${planLine}\n   ◇  ${addonLine}`);

  if (data.next_daily_grant_amount > 0) {
    const dailyPts = data.next_daily_grant_amount.toLocaleString("en-US");
    const dailyDate = formatGrantDate(data.next_daily_grant_time);
    logger.info(`Next daily grant: ${theme.accent(`${dailyPts} pts`)} (${dailyDate})`);
  }

  if (data.next_monthly_grant_amount > 0) {
    const monthlyPts = data.next_monthly_grant_amount.toLocaleString("en-US");
    const monthlyDate = formatGrantDate(data.next_monthly_grant_time);
    logger.info(`Next monthly grant: ${theme.accent(`${monthlyPts} pts`)} (${monthlyDate})`);
  }
}

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

  if (flags.dryRun) {
    await container.options.resolveApiKey({
      envValue: container.env.getVariable("POE_API_KEY"),
      assumeYes: true,
      dryRun: true
    });
    resources.logger.intro("usage balance");
    resources.logger.dryRun(
      "Dry run: would fetch usage balance from Poe API."
    );
    return;
  }

  resources.logger.intro("usage balance");

  try {
    const apiKey = await container.options.resolveApiKey({
      envValue: container.env.getVariable("POE_API_KEY"),
      assumeYes: flags.assumeYes,
      dryRun: false
    });

    const data = await withSpinner<BalanceResponse>({
      message: "Fetching usage balance...",
      fn: async () => {
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

        return (await response.json()) as BalanceResponse;
      },
      stopMessage: () => "Usage balance fetched"
    });

    renderBalanceDisplay(data, resources.logger);
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
    .alias("u")
    .description("Check Poe API usage information.")
    .action(async () => {
      await executeBalance(program, container);
    });

  usage
    .command("balance", { hidden: true })
    .description("Display current point balance.")
    .action(async () => {
      await executeBalance(program, container);
    });

  usage
    .command("list")
    .description("Display usage history.")
    .option("--filter <model>", "Filter results by model name")
    .option("--pages <count>", "Number of pages to load automatically", parsePositivePageCount)
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "usage:list"
      );
      const commandOptions = this.opts<{ filter?: string; pages?: number }>();

      if (flags.dryRun) {
        await container.options.resolveApiKey({
          envValue: container.env.getVariable("POE_API_KEY"),
          assumeYes: true,
          dryRun: true
        });
        resources.logger.intro("usage list");
        resources.logger.dryRun(
          "Dry run: would fetch usage history from Poe API."
        );
        return;
      }

      resources.logger.intro("usage list");

      try {
        const apiKey = await container.options.resolveApiKey({
          envValue: container.env.getVariable("POE_API_KEY"),
          assumeYes: flags.assumeYes,
          dryRun: false
        });

        const theme = getTheme();
        const filterTerm = commandOptions.filter?.trim();
        const tzAbbr = Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
          .formatToParts(new Date())
          .find((p) => p.type === "timeZoneName")?.value ?? "local";
        const dateTitle = `Date [${tzAbbr}]`;
        const dateWidth = Math.max(16, dateTitle.length);
        const costTitle = "Cost";
        const costWidth = 24;
        const tokenWidth = 10;
        const tableChrome = 22;
        const modelMaxWidth = Math.max(20, widths.maxLine - dateWidth - costWidth - tokenWidth * 3 - tableChrome);
        const tableColumns = [
          { name: "Date", title: dateTitle, alignment: "left" as const, maxLen: dateWidth },
          { name: "Model", title: "Model", alignment: "left" as const, maxLen: modelMaxWidth },
          { name: "Cost", title: costTitle, alignment: "right" as const, maxLen: costWidth },
          { name: "Input", title: "Input tkn", alignment: "right" as const, maxLen: tokenWidth },
          { name: "Output", title: "Output tkn", alignment: "right" as const, maxLen: tokenWidth },
          { name: "Cached", title: "Cached tkn", alignment: "right" as const, maxLen: tokenWidth }
        ];

        const formatEntry = (entry: {
          creation_time: number;
          bot_name: string;
          cost_usd: string;
          cost_points: number;
          cost_breakdown_in_points?: Record<string, string>;
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
          const bd = entry.cost_breakdown_in_points;
          const parseTokens = (s: string | undefined): string => {
            if (!s) return "-";
            const start = s.indexOf("(");
            const end = s.indexOf(" tokens");
            if (start === -1 || end === -1) return "-";
            return s.slice(start + 1, end);
          };
          return {
            Date: theme.muted(formatted),
            Model: theme.accent(modelName),
            Cost: entry.cost_points < 0
              ? theme.error(costText)
              : theme.success(costText),
            Input: theme.muted(parseTokens(bd?.Input)),
            Output: theme.muted(parseTokens(bd?.Output)),
            Cached: theme.muted(parseTokens(bd?.["Cache discount"]))
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
            url += `&starting_after=${encodeURIComponent(startingAfter)}`;
          }

          const result = await withSpinner<{
            has_more: boolean;
            data: Array<{
              query_id: string;
              creation_time: number;
              bot_name: string;
              cost_usd: string;
              cost_points: number;
              cost_breakdown_in_points?: Record<string, string>;
            }>;
          }>({
            message: `Fetching usage history page ${pagesLoaded + 1}...`,
            fn: async () => {
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

              return (await response.json()) as {
                has_more: boolean;
                data: Array<{
                  query_id: string;
                  creation_time: number;
                  bot_name: string;
                  cost_usd: string;
                  cost_points: number;
                  cost_breakdown_in_points?: Record<string, string>;
                }>;
              };
            },
            stopMessage: (page) => `${page.data.length} usage entries fetched`
          });

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

          if (maxPages === undefined && !flags.assumeYes) {
            if (process.stdin.isTTY !== true) {
              break;
            }

            const shouldContinue = await confirm({ message: "Load more?" });
            if (isCancel(shouldContinue)) {
              throw new OperationCancelledError();
            }
            if (!shouldContinue) {
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
