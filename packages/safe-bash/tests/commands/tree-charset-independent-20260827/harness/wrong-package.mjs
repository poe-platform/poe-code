const loaded = await import("virtual-bash");
if (loaded.marker === "wrong-package") throw new Error("wrong package was detected");
throw new Error("unexpected package fallback");
