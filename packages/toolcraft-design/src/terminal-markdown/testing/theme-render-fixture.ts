import { renderMarkdown, resetThemeCache } from "../../index.js";

const MARKDOWN_DARK =
  "# Dark Theme\n\n**Bold** and *italic* with `code` and a [link](https://example.com)\n\n> [!NOTE]\n> This is a note\n\n| Col1 | Col2 |\n|------|------|\n| a | b |";

const MARKDOWN_LIGHT =
  "# Light Theme\n\n**Bold** and *italic* with `code` and a [link](https://example.com)\n\n> [!WARNING]\n> This is a warning\n\n- Item 1\n- [x] Done\n- [ ] Todo";

const hasAnsi = (s: string): boolean => s.includes("\x1b[");

process.env.FORCE_COLOR = "1";

process.env.POE_THEME = "dark";
delete process.env.POE_CODE_THEME;
resetThemeCache();
const darkOutput = renderMarkdown(MARKDOWN_DARK);
process.stdout.write(darkOutput);

process.env.POE_THEME = "light";
resetThemeCache();
const lightOutput = renderMarkdown(MARKDOWN_LIGHT);
process.stdout.write(lightOutput);

if (!hasAnsi(darkOutput)) {
  process.stderr.write("DARK_THEME_NO_ANSI\n");
  process.exit(1);
}

if (!hasAnsi(lightOutput)) {
  process.stderr.write("LIGHT_THEME_NO_ANSI\n");
  process.exit(1);
}

if (darkOutput === lightOutput) {
  process.stderr.write("THEMES_NOT_DISTINCT\n");
  process.exit(1);
}

process.stdout.write("THEMES_VALIDATED\n");
