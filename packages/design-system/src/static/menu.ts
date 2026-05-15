import { color } from "../components/color.js";
import { symbols } from "../components/symbols.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { getTheme } from "../internal/theme-detect.js";

export interface MenuOption {
  label: string;
  value: string;
  hint?: string;
}

export interface RenderMenuOptions {
  message: string;
  options: MenuOption[];
  selectedIndex?: number;
}

export function renderMenu(opts: RenderMenuOptions): string {
  const format = resolveOutputFormat();
  const selectedIndex = opts.selectedIndex ?? 0;

  if (format === "markdown") {
    return [
      `**${opts.message}**`,
      ...opts.options.map(
        (option, index) => `- [${index === selectedIndex ? "x" : " "}] ${option.label}`
      )
    ].join("\n");
  }

  if (format === "json") {
    return JSON.stringify({
      type: "menu",
      message: opts.message,
      options: opts.options,
      selected: selectedIndex
    });
  }

  const theme = getTheme();
  const bar = color.gray(symbols.bar);
  const lines: string[] = [];

  lines.push(`${color.cyan(symbols.active)}  ${opts.message}`);
  lines.push(bar);

  opts.options.forEach((option, index) => {
    const isSelected = index === selectedIndex;
    const prefix = isSelected ? color.cyan(symbols.active) : color.gray(symbols.inactive);
    const label = isSelected ? theme.accent(option.label) : option.label;
    const hint = option.hint ? color.dim(` (${option.hint})`) : "";
    lines.push(`${bar}  ${prefix} ${label}${hint}`);
  });

  lines.push(`${bar}`);
  return lines.join("\n");
}
