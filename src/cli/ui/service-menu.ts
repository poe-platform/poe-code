import chalk from "chalk";
import type { ProviderService } from "../service-registry.js";
import { getTheme, resolveThemeName, type ThemeName } from "@poe-code/design-system";

const HEADER_WIDTH = 70;

const repeat = (char: string, count: number): string => char.repeat(count);

const CLI_COPY = {
  tagline: "Configure coding agents to use the Poe API.",
  get menuHeader() {
    return `poe-code · ${this.tagline}`;
  },
  serviceSelection: (action: string) => `Pick an agent to ${action}:`
};

export interface RenderServiceMenuOptions {
  themeName?: ThemeName;
}

export function formatServiceLabel(
  service: ProviderService,
  themeName: ThemeName = "dark"
): string {
  const colors = service.branding?.colors;
  if (colors) {
    const preferred =
      themeName === "dark"
        ? colors.dark ?? colors.light
        : colors.light ?? colors.dark;
    if (preferred) {
      return chalk.hex(preferred).bold(service.label);
    }
  }
  return service.label;
}

export function renderServiceMenu(
  services: ProviderService[],
  options?: RenderServiceMenuOptions
): string[] {
  const themeName = options?.themeName ?? resolveThemeName();
  const palette = getTheme();
  const border = repeat("=", HEADER_WIDTH);
  const divider = repeat("-", HEADER_WIDTH);

  const lines: string[] = [
    palette.divider(border),
    palette.header(CLI_COPY.menuHeader),
    palette.divider(divider),
    palette.prompt(CLI_COPY.serviceSelection("configure"))
  ];

  services.forEach((service, index) => {
    const number = palette.number(`[${index + 1}]`);
    const label = formatServiceLabel(service, themeName);
    lines.push(`${number} ${label}`);
  });

  lines.push(palette.divider(divider));

  return lines;
}
