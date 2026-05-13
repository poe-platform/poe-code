---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# API shape providers

Generalize provider compatibility around API shapes instead of treating Poe as the central API.

## 1. What we're building

We are phasing out the Poe API as the assumed center of provider configuration.

Instead of saying a provider supports an agent directly, each coding agent declares the API shapes it can be configured with. The initial API shapes are:

- OpenAI chat completions
- OpenAI responses
- Anthropic messages
- Google generations

Each auth provider declares which API shapes it exposes, plus the API key and base URL for those shapes. First-party providers get default base URLs, and custom providers can override base URLs without changing agent configuration code.

Adding a provider should be a matter of adding one declarative provider file. Everything else should be derived from that provider config. Host code must not add provider-specific if/case branches.

Poe becomes one provider that exposes multiple API shapes: chat completions, responses, and messages. It does not expose Google generations. Agents that need any of those shapes can still be configured through Poe because compatibility is computed from the agent's required API shape and the provider's exposed API shapes.

This builds on the existing `@poe-code/providers` package rather than creating a parallel abstraction. The current provider manifest already owns auth, base URL, environment variables, and provider registry behavior; this plan extends that manifest from `supportsAgents` to API-shape capabilities and moves agent compatibility into declarative agent metadata.

Explicit non-goals:

- Do not add provider-specific branches in configure, spawn, SDK, or CLI code.
- Do not require changes outside one provider file when adding a provider.
- Do not make providers know about logging, dry-run behavior, prompts, or coding-agent internals.
- Do not remove Poe support; reframe Poe as a multi-shape provider.
- Do not implement external provider plugins or third-party package loading in this feature.
