---
severity: medium
impact: usability
comment: "Fair-minded and useful: the Docker/E2B missing-dependency messages are the best recovery copy in the product (install links, env var, config path) and they are dressed as crashes with a useless log pointer. Its framing is the sharpest statement of the systemic UserError issue - 'chrome trains crash response' - and it makes the case that classification matters most precisely where the content is already good. Retire into ux-user-errors-look-like-system-failures.md, keeping this as the exemplar."
---

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
