# UX: configure unknown provider is clear but no recovery list

## Summary

configure --provider bogus: Unknown provider "bogus" — clear; should list available providers (poe, anthropic, openai, cloudflare).

## Evidence

■  Error: Unknown provider "bogus".

## Why it matters

Good ValidationError; add allow-list.

## Suggested direction

Unknown provider "bogus". Expected: poe, anthropic, openai, cloudflare.

## Severity

Low–Medium

## Area

Configure
