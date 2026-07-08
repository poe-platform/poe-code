# UX: Missing Docker/E2B deps have excellent recovery text but system-error chrome

## Summary

spawn --runtime docker/e2b missing engine/API key messages include install links and config paths (excellent) but still use Error: + See logs at errors.log framing.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --runtime e2b
■  Error: No E2B API key. Set E2B_API_KEY or e2b.api_key in …
●  See logs …

$ poe-code spawn claude "hi" --mode read --runtime docker
■  Error: No container engine found. Please install Docker or Podman:
│  - Docker Desktop: …
●  See logs …
```

## Why it matters

Content is model user guidance; chrome trains crash response and useless log file.

## Suggested direction

Classification as user/setup error without errors.log; keep install links.

## Severity

Medium

## Area

Runtime / errors
