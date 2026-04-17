---
kind: superintendent
version: 1

builder:
  agent: claude-code
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  pi-mono-reference:
    agent: claude-code
    prompt: |
      Fetch https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent and enumerate every feature, tool, hook, config option, and dependency. Flag anything missing from the builder's notes.

  poe-agent-mapping:
    agent: claude-code
    prompt: |
      Review @poe-code/poe-agent (plugins, runtime, hooks, types). For each pi-mono feature the builder listed, mark it as: already-present, partial, or missing. Call out any naming or contract mismatches that would block a drop-in compliant agent.

  gaps-and-risks:
    agent: claude-code
    prompt: |
      Identify open questions, licensing concerns, and integration risks (breaking AgentPlugin API, duplicated plugins, LLM provider assumptions, MCP differences). Reject scope creep — this plan is discovery only, not implementation.

superintendent:
  agent: claude-code
  prompt: |
    Review builder and inspector output, update the Task Board in {{plan.path}}, and decide whether we have enough information to build a pi-mono-compliant agent inside @poe-code/poe-agent. If any feature, contract, or risk is unresolved, send it back to the builder. Request owner review once the discovery board is complete.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## pi-mono reference
    {{inspectors.pi-mono-reference}}

    ## poe-agent mapping
    {{inspectors.poe-agent-mapping}}

    ## Gaps and risks
    {{inspectors.gaps-and-risks}}

owner:
  agent: claude-code
  prompt: |
    Decide whether the discovery is complete: do we have every feature, contract, and risk we need to write a follow-up implementation plan for a pi-mono-compliant poe-agent? Approve or send back with specific feedback.

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 100

status:
  state: in_progress
  round: 0
  review_turn: 0
---

# pi-mono coding-agent Integration — Discovery

## Summary

Before writing a line of integration code, produce a complete, verifiable picture of what `badlogic/pi-mono/packages/coding-agent` actually provides and how each feature maps onto `@poe-code/poe-agent`. The output of this plan is a discovery document: feature inventory, contract diff, and open questions — enough to write a follow-up implementation plan with confidence.

## 1. Problem

We want `@poe-code/poe-agent` to be a compliant superset (or drop-in peer) of pi-mono's coding-agent. Today we do not have a written inventory of:

- Every tool pi-mono ships (name, args, return shape, side effects).
- Every hook / lifecycle event and its decision contract.
- The LLM / provider abstraction (streaming, tool-use shape, images, errors).
- The config format (env vars, CLI args, file-based config).
- The MCP surface (server spec, transport, tool-namespacing).
- Memory / context model (AGENTS.md, compaction, conversation store).
- The policy / permission model (modes, allowlists, command parsing).
- Build & runtime deps (which libraries, versions, licences).

Without that inventory, any integration work risks missing features, duplicating plugins we already have, or locking us into an incompatible contract.

### Out of scope

- Writing the integration code.
- Porting pi-mono features into poe-code.
- Changes to `@poe-code/agent-spawn`, `@poe-code/cmdkit`, or the design system.
- Deciding the final architecture — that belongs in the follow-up implementation plan.

## 2. Principles

- Discovery only. Produce documents, not code.
- Be exhaustive: every exported symbol, every tool, every hook, every config key.
- Cite sources: every claim in the feature inventory links to the pi-mono file and line range.
- Map, don't merge: the mapping doc compares, it does not pick a winner.
- No regexes, no "probably" — if something is unclear, add it to the open-questions list.

## 3. Deliverables

All deliverables live under `docs/plans/pi-mono/` (create the folder as part of task 1):

1. `feature-inventory.md` — exhaustive list of pi-mono coding-agent features with source links.
2. `contract-diff.md` — side-by-side of pi-mono ↔ poe-agent for tools, hooks, plugin API, tool-result shape, MCP, memory, policy, compaction.
3. `dependency-audit.md` — pi-mono runtime deps + licences + poe-code equivalents (if any).
4. `open-questions.md` — unresolved items blocking an implementation plan (ambiguous contracts, missing docs, licence questions, provider assumptions).
5. `integration-options.md` — candidate integration shapes (vendored fork, adapter layer, plugin ports) with trade-offs — no decision, just options.

## 4. Investigation Checklist

Each deliverable must cover these dimensions; the superintendent rejects any deliverable that skips one without a recorded reason in `open-questions.md`.

- **Tools**: name, JSON schema / arg types, return shape, streaming, cancellation, images, structured errors.
- **Hooks / lifecycle**: every event, argument shape, decision contract, ordering guarantees.
- **Plugin / extension API**: how third parties add tools, prompts, hooks, MCP servers.
- **System prompt**: static content, dynamic injections, per-provider variants.
- **Memory**: file lookup paths, `@import` behaviour, precedence rules.
- **Compaction / context management**: trigger, strategy, hook points.
- **Policy / permissions**: modes, per-tool metadata vs central config, command parsing library.
- **MCP**: server config shape, transport (stdio/http), tool namespacing, visibility to model vs skill.
- **LLM / provider layer**: which providers are supported, streaming protocol, tool-use protocol, images, errors.
- **Config**: env vars, CLI args, file config, precedence.
- **Logging / audit**: what is persisted, where, format.
- **Tests**: what test surface exists upstream, and what would we need for parity.

## Task Board

- [ ] Create `docs/plans/pi-mono/` folder and stub the five deliverable files with section skeletons
- [ ] Enumerate every pi-mono coding-agent tool (args, return, side effects) into `feature-inventory.md` with source links
- [ ] Enumerate every pi-mono hook / lifecycle event and its decision contract into `feature-inventory.md`
- [ ] Document pi-mono's plugin / extension API, system prompt flow, memory lookup, compaction, and policy model in `feature-inventory.md`
- [ ] Document pi-mono's MCP surface, LLM/provider abstraction, config precedence, and audit/logging in `feature-inventory.md`
- [ ] Fill `contract-diff.md` — side-by-side pi-mono ↔ poe-agent for tools, hooks, plugin API, tool-result shape, MCP, memory, policy, compaction
- [ ] Fill `dependency-audit.md` — pi-mono runtime deps, versions, licences, poe-code equivalents
- [ ] Fill `open-questions.md` with every ambiguity, missing doc, and licence question flagged during discovery
- [ ] Fill `integration-options.md` with candidate integration shapes (vendored fork, adapter, plugin ports) and trade-offs
- [ ] Cross-check the discovery against [docs/plans/poe-agent-agentic-features.md](docs/plans/poe-agent-agentic-features.md) — mark overlaps so the two plans do not double-cover work
- [ ] Superintendent review: confirm every feature in `feature-inventory.md` appears in `contract-diff.md`, and every `open-questions.md` item has an owner or a resolution path
