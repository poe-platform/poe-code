# UX: models --endpoint invalid lists available endpoints but still prints stack

## Summary

Unsupported endpoint message lists Available endpoints (good) but still ERROR log + ValidationError stack — mixed quality.

## Evidence

```bash
$ poe-code models --endpoint /v1/bogus
■  Error during models: Unsupported endpoint "/v1/bogus". Available endpoints: …
# + Stack trace
```

## Why it matters

Recovery content is excellent; stack ruins it.

## Suggested direction

Keep message; drop stack for ValidationError.

## Severity

**High**

## Area

Models / errors
