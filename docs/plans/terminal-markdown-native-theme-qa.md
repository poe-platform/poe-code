# Terminal Markdown native theme QA

Unit tests cover palette switching and readable styled Markdown in process.
Validate the maintained built fixture outside fast unit startup deadlines.

1. Build `toolcraft-design` through the maintained workspace build closure.
2. Run `node packages/toolcraft-design/dist/terminal-markdown/testing/theme-render-fixture.js`
   with stdout/stderr captured only under `out/`. The fixture renders dark-theme
   heading, bold/italic/code/link, note and table examples, then light-theme
   heading, formatting, warning, list and task-list examples. It forces color,
   selects each POE_THEME explicitly and resets the theme cache between renders.
3. Require exit status zero, empty stderr, both Dark Theme and Light Theme
   headings, and THEMES_VALIDATED. The fixture independently rejects either
   theme without ANSI styling and rejects identical outputs.
4. Capture and inspect an ad hoc screenshot of the fixture using the maintained
   screenshot command. Confirm headings, links, notes/warnings, table and list
   content are readable and the two palettes are visually distinct.
5. Remove only owned captures and screenshots after inspection. A missing case,
   unreadable rendering, native process error or failed assertion fails QA.
