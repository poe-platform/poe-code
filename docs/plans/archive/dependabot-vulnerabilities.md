---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: refresh-npm-lockfile-vulnerabilities
    title: Refresh npm lockfile vulnerabilities
    prompt: |
      Resolve the open GitHub Dependabot alerts reported against `package-lock.json`
      for repository `poe-platform/poe-code`. Prefer a generated npm lockfile
      refresh over manual lockfile edits, and do not add direct dependencies or
      overrides unless normal npm resolution cannot select patched transitive
      versions.

      Alerts to resolve in `package-lock.json`:
      - #17 `hono` high, GHSA-q5qw-h33p-qvwr / CVE-2026-29045, vulnerable `< 4.12.4`, fixed `4.12.4`.
      - #18 `hono` medium, GHSA-p6xx-57qc-3wxr / CVE-2026-29085, vulnerable `< 4.12.4`, fixed `4.12.4`.
      - #19 `hono` medium, GHSA-5pq2-9x2x-5p6w / CVE-2026-29086, vulnerable `< 4.12.4`, fixed `4.12.4`.
      - #20 `@hono/node-server` high, GHSA-wc8c-qw6v-h7f6 / CVE-2026-29087, vulnerable `< 1.19.10`, fixed `1.19.10`.
      - #23 `hono` medium, GHSA-v8w9-8mx6-g223, vulnerable `< 4.12.7`, fixed `4.12.7`.
      - #26 `flatted` high, GHSA-rf6f-7fwh-wjgh / CVE-2026-33228, vulnerable `<= 3.4.1`, fixed `3.4.2`.
      - #27 `smol-toml` medium, GHSA-v3rj-xjv7-4jmq, vulnerable `< 1.6.1`, fixed `1.6.1`.
      - #40 `@hono/node-server` medium, GHSA-92pp-h63x-v22m / CVE-2026-39406, vulnerable `< 1.19.13`, fixed `1.19.13`.
      - #41 `hono` medium, GHSA-wmmm-f939-6g9c / CVE-2026-39407, vulnerable `< 4.12.12`, fixed `4.12.12`.
      - #42 `hono` medium, GHSA-xf4j-xp2r-rqqx / CVE-2026-39408, vulnerable `>= 4.0.0, <= 4.12.11`, fixed `4.12.12`.
      - #43 `hono` medium, GHSA-26pp-8wgv-hjvm, vulnerable `< 4.12.12`, fixed `4.12.12`.
      - #44 `hono` medium, GHSA-xpcf-pg52-r92g / CVE-2026-39409, vulnerable `< 4.12.12`, fixed `4.12.12`.
      - #45 `hono` medium, GHSA-r5rp-j6wh-rvv4 / CVE-2026-39410, vulnerable `< 4.12.12`, fixed `4.12.12`.
      - #47 `hono` medium, GHSA-458j-xx4x-4375, vulnerable `< 4.12.14`, fixed `4.12.14`.

      Acceptance criteria:
      - `package-lock.json` resolves every `hono` instance to `>= 4.12.14`.
      - `package-lock.json` resolves every `@hono/node-server` instance to `>= 1.19.13`.
      - `package-lock.json` resolves every `flatted` instance to `>= 3.4.2`.
      - `package-lock.json` resolves every `smol-toml` instance to `>= 1.6.1`.
      - If a direct `smol-toml` manifest range is changed, keep the root and
        workspace package manifests consistent.
      - Do not update README files for this dependency-only security fix.
    status:
      implement: done
      test: done

  - id: refresh-pnpm-lockfile-vulnerabilities
    title: Refresh pnpm lockfile vulnerabilities
    prompt: |
      Resolve the open GitHub Dependabot alerts reported against `pnpm-lock.yaml`
      for repository `poe-platform/poe-code`. Use pnpm lockfile generation or a
      YAML-aware update path; do not manually patch the lockfile with regexes.
      Preserve the existing npm package-manager setup and do not introduce new
      package-manager metadata unless the existing lockfile tooling requires it.

      Alerts to resolve in `pnpm-lock.yaml`:
      - #46 `hono` medium, GHSA-458j-xx4x-4375, vulnerable `< 4.12.14`, fixed `4.12.14`.
      - #48 `postcss` medium, GHSA-qx2v-qp2m-jg93 / CVE-2026-41305, vulnerable `< 8.5.10`, fixed `8.5.10`.

      Acceptance criteria:
      - `pnpm-lock.yaml` resolves every `hono` instance to `>= 4.12.14`.
      - `pnpm-lock.yaml` resolves every `postcss` instance to `>= 8.5.10`.
      - `pnpm-lock.yaml` no longer contains lockfile entries that select
        vulnerable `hono@4.12.12` or `postcss@8.5.9` versions.
      - `package-lock.json` remains at the patched versions required by the npm
        lockfile remediation task.
      - Do not update README files for this dependency-only security fix.
    status:
      implement: done
      test: done

  - id: verify-dependabot-remediation
    title: Verify Dependabot remediation
    prompt: |
      Verify that the npm and pnpm lockfile updates resolve the Dependabot
      vulnerabilities without breaking the repository.

      Required verification:
      - Run a dependency-tree check such as `npm ls hono @hono/node-server flatted smol-toml postcss --all --depth=10` after syncing dependencies, and confirm all installed versions satisfy the patched minimums: `hono >= 4.12.14`, `@hono/node-server >= 1.19.13`, `flatted >= 3.4.2`, `smol-toml >= 1.6.1`, and `postcss >= 8.5.10`.
      - Run the fastest relevant repository checks for a dependency-only change,
        including at least `npm run lint:types` and `npm test` unless a narrower
        failing check proves the same regression surface.
      - Re-query the Dependabot alerts with `gh api repos/poe-platform/poe-code/dependabot/alerts --paginate` when credentials are available. If GitHub still reports stale open alerts before the branch is pushed or merged, document that local lockfiles contain patched versions and that GitHub will rescan after the update reaches the protected branch.
      - Do not add unit tests for GitHub workflow files or write screenshot tests;
        no visual CLI validation is required for this lockfile-only change.
    status:
      test: done
---

# Dependabot vulnerabilities

Fetched from GitHub Dependabot alerts for `poe-platform/poe-code` and grouped by lockfile so the remediation can update dependency resolution instead of treating duplicate advisories as unrelated work.

The `package-lock.json` alerts are for `hono`, `@hono/node-server`, `flatted`, and direct `smol-toml`. The `pnpm-lock.yaml` alerts are for `hono` and `postcss`.
