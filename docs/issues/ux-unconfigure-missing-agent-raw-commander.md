# UX: unconfigure without agent is raw commander error

## Summary

unconfigure without agent: error: missing required argument agent — raw commander; unconfigure not-an-agent has See logs.

## Evidence

```bash
$ poe-code unconfigure
error: missing required argument 'agent'
$ poe-code unconfigure not-an-agent
■  Error: Unknown agent "not-an-agent".
●  See logs …
```

## Why it matters

Destructive command should list agents and use design-system.

## Suggested direction

ValidationError with agent list; UserError for unknown.

## Severity

Medium

## Area

Unconfigure
