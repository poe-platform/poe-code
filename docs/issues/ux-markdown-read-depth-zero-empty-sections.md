# UX: plan markdown-read --depth 0 yields empty sections

## Summary

markdown-read --depth 0 prints sections: (none) while file has content — depth 0 means no headings shown without explaining.

## Evidence

sections: (none) for depth 0

## Why it matters

Empty TOC looks broken; document depth semantics.

## Suggested direction

Default unlimited; depth 0 error or show all titles only.

## Severity

Low–Medium

## Area

Plan
