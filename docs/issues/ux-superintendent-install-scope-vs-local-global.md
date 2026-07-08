# UX: superintendent install uses --scope while others use --local/--global

## Summary

superintendent install --scope local|global (npm run dev help); experiment/pipeline use --local/--global — unified installer flags gap reconfirmed.

## Evidence

superintendent: --scope; experiment/pipeline: --local/--global.

## Why it matters

Users cannot transfer flag knowledge across installers.

## Suggested direction

Unified --local/--global everywhere; alias --scope.

## Severity

**High**

## Area

Install / flags
