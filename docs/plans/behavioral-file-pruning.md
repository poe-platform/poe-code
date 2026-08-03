---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Behavioral file pruning

Compress instruction files into extremely concise, human-readable documents while preserving all behavior that testing proves necessary.

## 1. What we're building

Build a semantic compression workflow for skills and other model-facing text files. It behaves like a compression algorithm whose decoded meaning is model behavior: scrutinize the source in small semantic units, remove knowledge already confirmed in the target models, deduplicate overlapping guidance, and rewrite necessary guidance into the shortest clear form. The result should resemble an index card rather than an abridged essay and must remain directly readable and editable by humans.

The workflow examines configured target models like a teacher: it derives questions and exercises from each unit, withholds the unit, tests the models, and grades their answers against evidence extracted from the original. Units whose knowledge is confirmed become candidates for removal; units that remain necessary become candidates for concise rewriting or consolidation.

The primary optimization target is minimum document size subject to three hard constraints: preserved required behavior, verified model knowledge, and human readability. It treats model knowledge as unverified until demonstrated by examination and task performance. A model's claim that it knows or does not need an instruction may prioritize an experiment, but must never authorize a removal.

Every accepted change must be supported by two layers of evidence. First, a closed-book knowledge examination confirms that each target model can supply the omitted information correctly. Second, the target models perform relevant tasks with the original and candidate files to confirm that they also apply the knowledge correctly. Outputs are evaluated against explicit success criteria, and the candidate is retained only when neither layer shows a meaningful regression. Uncertain, flaky, uncovered, or contradictory results preserve the original text.

The workflow must:

- support skills and arbitrary explicitly selected model-facing files;
- preserve file structure, metadata, references, invariants, and user-designated protected content;
- evaluate deletion and condensation candidates at semantic boundaries rather than blindly removing physical lines;
- search for deletions, shorter equivalent wording, merged rules, and removable repetition instead of limiting optimization to line removal;
- generate several question forms and practical exercises so passing does not depend on memorizing one phrasing or guessing a binary answer;
- test multiple configured models and repeated trials where nondeterminism can affect the verdict;
- produce an auditable report linking each accepted or rejected edit to its tasks, results, evaluator evidence, and confidence;
- report compression measurements, including original and candidate words, characters, tokens, and compression ratio;
- replace the selected source atomically after the complete compressed result passes verification;
- allow users to set cost, model, repetition, and minimum-evidence policies;
- fail closed: lack of evidence is never evidence that text is unnecessary.

Non-goals:

- inferring redundancy from model self-report alone;
- removing project-specific constraints merely because they resemble common best practices;
- proving that an instruction is unnecessary for every present or future model, task, or context;
- treating one correct answer, rote recall, or a model's confidence as sufficient proof of reliable knowledge;
- pruning executable source code, generated files, secrets, legal text, or files not explicitly selected;
- automatically applying a candidate whose behavioral coverage or evaluation criteria are incomplete;
- producing token-minimal shorthand that is ambiguous, cryptic, grammatically broken, or impractical for a human maintainer to edit.

## 2. User-facing shape

The feature is exposed as `poe-code compress` in the CLI and as a matching SDK function. A compression run accepts one explicitly selected text file, examines and tests it, and replaces it atomically with the verified compressed result. There is no separate apply step.

### Interactive CLI

```text
$ poe-code compress .codex/skills/release/SKILL.md

Compress  .codex/skills/release/SKILL.md

Target models
  Select one or more agents and models to examine
  > codex:<provider>/<cheap-model>
    claude-code:<provider>/<cheap-model>

Evidence policy
  Knowledge trials per unit  3
  Behavioral trials          3
  Required pass rate         100%

Protected content
  Frontmatter, code blocks, links and normative project rules

Examining 47 semantic units...
Testing 19 compression candidates across 2 models...

Report     .poe-code/compression/release-skill/2026-07-27T183000Z/report.md

1,842 → 611 tokens (66.8% smaller)
12 removed · 7 rewritten · 4 merged · 24 preserved
0 unverified removals

Compressed .codex/skills/release/SKILL.md
```

The interactive command prompts for every missing choice. It does not silently choose target models or evidence thresholds. `--yes` accepts documented conservative defaults.

### Non-interactive CLI

```text
poe-code compress <file> \
  --agent codex:<provider>/<cheap-model> \
  --agent claude-code:<provider>/<cheap-model> \
  --knowledge-trials 3 \
  --behavior-trials 3 \
  --required-pass-rate 1 \
  --max-cost-usd 5 \
  --yes
```

Supported options:

- `--agent <agent:model>` may be repeated and defines the exact model cohort for which knowledge is verified;
- `--knowledge-trials <n>` and `--behavior-trials <n>` set repetition counts;
- `--required-pass-rate <0..1>` sets the acceptance threshold;
- `--max-cost-usd <amount>` stops before the next call would exceed the budget and preserves every unresolved unit;
- `--protect <selector>` may be repeated to add protected semantic units;
- `--report <markdown|json>` selects machine- or human-readable terminal output;
- `--out <directory>` overrides the run artifact directory;
- `--yes` accepts conservative defaults for omitted non-target options and is required for non-interactive execution with defaults.

The source is written once, atomically, only after the entire result passes the evidence policy. When the budget is exhausted, a model fails, evaluation is inconclusive, or the process is interrupted, the source remains byte-for-byte unchanged and the report records the incomplete run.

### Report and review experience

The Markdown report begins with the compression result and verdict, followed by a compact change table:

```text
| Unit | Change  | Tokens | Knowledge | Behavior | Verdict   |
|------|---------|-------:|-----------|----------|-----------|
| U03  | remove  | -42    | 6/6       | 6/6      | accepted  |
| U11  | rewrite | -18    | 6/6       | 5/6      | preserved |
| U20  | merge   | -31    | 6/6       | 6/6      | accepted  |
```

Each row links to the original unit, candidate wording, generated examination, practical exercises, per-model outputs, evaluator evidence, and reason for the verdict. The report labels its scope with exact agent, provider, model, and available model-version identifiers. It says “verified for this cohort and test set,” never “universally known.”

The compressed source remains an ordinary file in the same format. Protected metadata and structural elements stay in place. No annotations, evidence markers, or compression-specific syntax are inserted into it.

### SDK parity

```ts
const result = await compressFile({
  file: ".codex/skills/release/SKILL.md",
  targets: [
    { agent: "codex", model: "<provider>/<cheap-model>" },
    { agent: "claude-code", model: "<provider>/<cheap-model>" }
  ],
  knowledgeTrials: 3,
  behaviorTrials: 3,
  requiredPassRate: 1,
  maxCostUsd: 5
});
```

`compressFile` returns the compressed content, structured report, compression measurements, evidence scope, cost, and whether the source changed. It writes only a complete result that is fully verified under the recorded policy and whose source content has not changed during the run.
