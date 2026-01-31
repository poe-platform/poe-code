# Design QA

Visual quality assurance checklist for poe-code CLI.

## Screenshots

Generate screenshots of CLI output:

```bash
npm run screenshot-poe-code -- <command>
```

## Task

1. Run each command through the screenshot script
2. Review each screenshot
3. Verify all output uses the design system correctly
4. Ensure great user experience for CLI users

## Design System Usage

Always import from `@poe-code/design-system`:

```typescript
import { intro, outro, text, symbols, log } from "@poe-code/design-system";
```

Never import directly from `@clack/prompts` - use the design-system wrappers.

## Common Issues

- Commands not using the design language
- Direct @clack/prompts imports instead of design-system
- Hardcoded colors instead of tokens
- Missing or incorrect symbols
- Commands outputting information that is not useful

## Commands to Check

```bash
# Core help
npm run screenshot-poe-code -- --help
npm run screenshot-poe-code -- configure --help
npm run screenshot-poe-code -- install --help
npm run screenshot-poe-code -- spawn --help
npm run screenshot-poe-code -- wrap --help
npm run screenshot-poe-code -- test --help
npm run screenshot-poe-code -- unconfigure --help
npm run screenshot-poe-code -- login --help
npm run screenshot-poe-code -- generate --help
npm run screenshot-poe-code -- mcp --help

# Dry-run simulations
npm run screenshot-poe-code -- configure claude-code --dry-run --yes --api-key sk-test
npm run screenshot-poe-code -- unconfigure claude-code --dry-run --yes
npm run screenshot-poe-code -- spawn claude "hi" --dry-run
npm run screenshot-poe-code -- login --dry-run --yes --api-key sk-test
```

## Regenerate Design Docs

After making visual changes:

```bash
npm run generate:design-docs
```

This regenerates [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md) with updated screenshots.
