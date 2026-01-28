# CLI Screenshots

## Tool

Use [freeze](https://github.com/charmbracelet/freeze) from Charmbracelet.

Install: `brew install charmbracelet/tap/freeze`

## Usage

```bash
npm run screenshot -- login --help
```

Outputs: `screenshots/login-help.png`

## Implementation Plan

1. Create `scripts/screenshot.sh`:
   - Takes CLI args (e.g., `login` or `--help`)
   - Generates filename from args (spaces → dashes, strip leading dashes)
   - Runs `npm run dev --silent -- $args 2>&1 | freeze -o "$output" --window --padding 20`
   - Prints output path

2. Add npm script to package.json:

   ```json
   "screenshot": "bash scripts/screenshot.sh"
   ```

3. Add `screenshots/` to `.gitignore`
