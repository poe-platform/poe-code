# @poe-code/design-system

Shared terminal UI components, themes, prompt primitives, and static renderers for Poe Code packages.

## Components

- `createLogger` / `logger`: consistent scoped log output.
- `helpFormatter`: usage, command, and option formatting for CLI help.
- `renderTable`: tabular and detail-style row rendering.
- `renderDetailCard`: title, subtitle, prose, badge, section, and label/value rendering for rich command results.
- `renderTemplate`: Mustache-backed text rendering with configured escaping.
- `prompts`: themed select, multiselect, text, password, confirm, spinner, and note helpers.
- `dashboard` / `explorer`: interactive terminal layouts.
- `terminal-markdown`: Markdown parsing and terminal rendering.

## `renderDetailCard`

Use detail cards when command output is a single record with scalar fields and nested sections:

```ts
import { getTheme, renderDetailCard } from "@poe-code/design-system";

const output = renderDetailCard({
  theme: getTheme(),
  title: "Deployment",
  subtitle: "production",
  badges: ["SUCCESS"],
  sections: [
    {
      rows: [
        { label: "Version", value: "v3.0.228" },
        { label: "URL", value: "https://example.com/releases/v3.0.228" }
      ]
    }
  ]
});
```

The renderer wraps long values, aligns labels, formats optional prose blocks, and skips empty sections.

## Environment variables

| Env var                   | Behavior                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `POE_CODE_THEME`          | Explicit theme override. Supports `light` or `dark`; takes precedence over `POE_THEME`. |
| `POE_THEME`               | Theme override used when `POE_CODE_THEME` is not set. Supports `light` or `dark`.       |
| `APPLE_INTERFACE_STYLE`   | Theme detection fallback; `Dark` selects the dark theme, other values select light.     |
| `VSCODE_COLOR_THEME_KIND` | Theme detection fallback; values containing `dark` or `light` select that theme.        |
| `COLORFGBG`               | Theme detection fallback based on the terminal background color code.                   |
| `OUTPUT_FORMAT`           | Static rendering mode. Supports `terminal`, `markdown`, or `json`.                      |
| `FORCE_COLOR`             | Forces ANSI color when set to any value except `0`.                                     |
| `NO_COLOR`                | Disables ANSI color unless `FORCE_COLOR` is set.                                        |
| `TERM`                    | Used for color support detection; `dumb` disables color without `FORCE_COLOR`.          |
| `POE_NO_SPINNER`          | Set to `1` to render spinner fallbacks instead of animated spinners.                    |

## Config options

This package has no file-based configuration. Components are configured by function options, such as the `theme`, `columns`, `rows`, `width`, and prompt option objects passed to exported helpers.
