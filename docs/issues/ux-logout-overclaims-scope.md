# UX: logout copy overpromises and overreaches user intent

## Summary

logout described as Remove all configuration and credentials but unconfigures every agent and deletes config files. Env POE_API_KEY may remain.

## Evidence

Help: Remove all configuration and credentials.
Implementation: logout providers, unconfigure all agents, delete config files.

## Why it matters

Destructive by surprise; wording mismatches residual env credentials.

## Suggested direction

Split logout (credentials only) vs reset; or rename description; require confirm.

## Severity

**Critical**

## Area

Auth / destructive
