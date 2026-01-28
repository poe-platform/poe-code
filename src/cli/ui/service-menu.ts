import chalk from "chalk";
import type { ProviderService } from "../service-registry.js";
import {
  defaultMenuTheme,
  type MenuTheme
} from "./theme.js";
import { createCliCopy } from "./design-language.js";

const HEADER_WIDTH = 70;

const repeat = (char: string, count: number): string => char.repeat(count);

export interface RenderServiceMenuOptions {
  theme?: MenuTheme;
}

export function formatServiceLabel(
  service: ProviderService,
  theme: MenuTheme
): string {
  const palette = theme.palette;
  const colors = service.branding?.colors;
  if (colors) {
    const preferred =
      theme.name === "dark"
        ? colors.dark ?? colors.light
        : colors.light ?? colors.dark;
    if (preferred) {
      return chalk.hex(preferred).bold(service.label);
    }
  }
  return palette.providerFallback(service.label);
}

export function renderServiceMenu(
  services: ProviderService[],
  options?: RenderServiceMenuOptions
): string[] {
  const theme = options?.theme ?? defaultMenuTheme;
  const palette = theme.palette;
  const copy = createCliCopy();
  const border = repeat("=", HEADER_WIDTH);
  const divider = repeat("-", HEADER_WIDTH);

  const lines: string[] = [
    palette.divider(border),
    palette.header(copy.menuHeader),
    palette.divider(divider),
    palette.prompt(copy.serviceSelection("configure"))
  ];

  services.forEach((service, index) => {
    const number = palette.number(index + 1);
    const label = formatServiceLabel(service, theme);
    lines.push(`${number} ${label}`);
  });

  lines.push(palette.divider(divider));

  return lines;
}
