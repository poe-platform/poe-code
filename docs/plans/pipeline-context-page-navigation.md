# Pipeline context page navigation

Two failing regressions at 120x24 and 50x16 show that PageUp skips log entries when the fixed plan area reduces output space. Navigation computed a page using the original pane geometry, rather than the visible log height.

Use the rendered output viewport height for page navigation. This also accounts for the optional performance row. Preserve existing scroll retention and follow behavior.

Run maintained design workspace tests and lint. Execute a terminal simulation, inspect PageUp/Follow screenshots, then commit and push this independent navigation repair to main. Monitor publication of the final change.
