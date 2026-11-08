const first = "--- first\n+++ first\n@@ -1 +1 @@\n-keep\n+changed\n";
const repeated = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n";

export const repeatedMatchFixtures = [
  { name: "adjacent repeated headers", target: "old\nold\ntail\n", input: first + repeated },
  { name: "later duplicate conflicts", target: "old\nmiddle\nold\n", input: first + repeated },
  { name: "only consumed match conflicts", target: "old\nmiddle\ntail\n", input: first + repeated },
  { name: "positive offset then adjacent", target: "prefix\nold\nold\ntail\n", input: first + repeated },
  { name: "positive offset then later duplicate", target: "prefix\nold\nmiddle\nold\n", input: first + repeated },
  { name: "negative offset then adjacent", target: "old\nold\ntail\n", input: first + repeated.replaceAll("@@ -1 +1 @@", "@@ -4 +4 @@") },
  { name: "negative offset then later duplicate", target: "old\nmiddle\nold\n", input: first + repeated.replaceAll("@@ -1 +1 @@", "@@ -4 +4 @@") },
  { name: "backward search stays unconsumed", target: "old\nnext\ntail\n", input: first + "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n@@ -3 +3 @@\n-next\n+other\n" },
  { name: "positive direction wins equal distance", target: "old\nmiddle\nold\n", input: first + "--- target\n+++ target\n@@ -2 +2 @@\n-old\n+new\n" },
  { name: "negative offset two consumed lines adjacent", target: "old\nanchor\nold\ntail\n", input: first + "--- target\n+++ target\n@@ -5,2 +5,2 @@\n-old\n-anchor\n+new\n+anchor\n@@ -5 +5 @@\n-old\n+other\n" },
  { name: "negative offset two consumed lines later conflict", target: "old\nanchor\nmiddle\nold\n", input: first + "--- target\n+++ target\n@@ -5,2 +5,2 @@\n-old\n-anchor\n+new\n+anchor\n@@ -5 +5 @@\n-old\n+other\n" },
] as const;
