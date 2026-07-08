# UX: test kimi Provider poe not found (reconfirmed)

## Summary

test kimi: Invalid configuration file ~/.kimi/config.toml — Provider poe not found in providers — reconfirm kimi credential/config path broken.

## Evidence

Provider poe not found in providers [type=value_error, input_value={'default_model': 'poe/ki…

## Why it matters

Reconfirm kimi not Poe-wired for health check.

## Suggested direction

configure kimi must write valid providers.poe; test uses it.

## Severity

**High**

## Area

Test / kimi
