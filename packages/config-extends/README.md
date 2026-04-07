# @poe-code/config-extends

Shared document-inheritance types for layered config resolution.

## API

Currently this package exposes shared TypeScript types only.

## Environment variables

This package does not read or expose any environment variables.

## Config options

### `ResolveOptions`

- `fs`: file system implementation with `readFile(path, encoding)`
- `autoExtend?`: automatically inherit from bases even when a document does not set `extends: true`
