# opencode-poe-auth

Poe authentication plugin for OpenCode with browser-based OAuth and manual API key entry.

## Install

```bash
npm install opencode-poe-auth
```

## Usage

Register the plugin with OpenCode:

```ts
import { PoeAuthPlugin } from "opencode-poe-auth";

const INTERNAL_PLUGINS = [
  PoeAuthPlugin
];
```

The plugin registers the `poe` auth provider and exposes two auth methods:

- `Login with Poe (browser)`
- `Manually enter API Key`

## Environment Variables

This package does not expose any environment variables.

## Config

This package does not expose any plugin-specific config options.
