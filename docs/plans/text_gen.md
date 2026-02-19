# Plan: `tokenfill` — Token-Length Text Generator

## README Draft (User Experience First)

---

# tokenfill

Generate text to an exact token count. Built for AI/LLM developers who need deterministic, reproducible text for testing prompts, benchmarking context windows, and evaluating token limits.

```bash
# Generate 2000 tokens of text
npx tokenfill 2000
```

## Install

```bash
npm install tokenfill
```

## Quick Start

### CLI

```bash
# Generate 1000 tokens using built-in articles
tokenfill 1000

# Output as JSON (for piping)
tokenfill 1000 --json
```

**CLI Output:**

```
$ tokenfill 2000

Recent breakthroughs in quantum error correction have brought us
closer to practical quantum computers. The development of topological
qubits represents a significant step forward...

Neural Architecture Search (NAS) automates the design of neural
network architectures. By exploring vast search spaces of possible
configurations...

As IoT devices proliferate, processing data at the edge rather
than in the cloud becomes increasingly important. The shift toward
edge computing architectures has been accelerat

── Stats ──────────────────────────────────────────────────
  Tokens: 2,000 / 2,000 target (cl100k_base)
```

### API

```javascript
import { tokenfill } from 'tokenfill';

// Simple — generate 2000 tokens from built-in articles
const result = await tokenfill(2000);
console.log(result.text);
console.log(result.actualTokens); // 1987

// With different tokenizer
const result = await tokenfill(4000, {
  tokenizer: 'o200k_base',
});
```

### Tokenizer

Uses `tiktoken` under the hood. Default tokenizer: `cl100k_base` (GPT-4, Claude).

```javascript
await tokenfill(1000, { tokenizer: 'o200k_base' }); // GPT-4o tokenizer
```

### Pipe-Friendly

```bash
# Pipe into your LLM testing tool
tokenfill 4000 | my-llm-bench --stdin

# Generate test prompts
tokenfill 2000 --json | jq '.text' | pbcopy

# Use in scripts
TOKENS=$(tokenfill 1000 --json | jq '.actualTokens')
```

---

## Implementation Plan

### Phase 1: Core (MVP)

1. **Package setup** — `packages/tokenfill/`, TypeScript, vitest
2. **Tokenizer wrapper** — thin wrapper around `tiktoken`
3. **Article corpus** — built-in articles, sequential concatenation
4. **Truncation** — cut off at exact token boundary
6. **Main API** — `tokenfill(tokenCount, options)`
7. **CLI** — commander-based, all options exposed

### Phase 0: Corpus Generation

Generate ~2M tokens of original content as separate markdown files covering obscure scientific fields (e.g., archaeoastronomy, magnetohydrodynamics, paleoclimatology, biosemiotics, quantum chromodynamics, astrochemistry, ethnobotany, cliodynamics, etc.). Each file is a standalone article. This corpus ships with the package.

### Phase 2: Polish

8. **Stats output** — corpus statistics

### Future: Multi-Modal Fixtures

Beyond text, `tokenfill` could generate fixtures for other media types at target file sizes or durations:

- **Images** — PNG/JPEG at target dimensions or file sizes
- **Audio** — WAV/MP3 at target duration or file size
- **Video** — MP4 at target duration or file size
- **PDF** — multi-page PDFs at target page/token counts

This would make `tokenfill` a one-stop fixture generator for testing LLM multi-modal pipelines, file upload limits, and media processing.

### Decisions

- [x] Location: `packages/tokenfill/` within this monorepo
- [x] Built-in articles: curated original tech/science articles
- [x] Zero config: `tokenfill 2000` works out of the box with built-in articles
