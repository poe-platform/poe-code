# Explorer TUI Library QA

## Setup

- [ ] Start the single-detail demo: `npm run demo:explorer -- --mode single-detail-mode`.
- [ ] Start the list-detail demo: `npm run demo:explorer -- --mode list-detail-mode`.
- [ ] Capture wide, medium, and narrow screenshots for both modes with `npm run screenshot-poe-code -- explorer-demo`.

## Keyboard Coverage

- [ ] Move the cursor with `Up`, `Down`, `k`, and `j`; verify the highlighted row and detail pane follow the cursor.
- [ ] Page with `Ctrl+u` and `Ctrl+d`; verify the cursor remains clamped to visible rows.
- [ ] Jump with `gg` and `G`; verify top and bottom rows are selected.
- [ ] Press `/`, type a filter, and press `Esc`; verify filtered counts, highlights, and reset behavior.
- [ ] Open the command palette with `Ctrl+P`, type part of an action name, and press `Enter`.
- [ ] Open and close help with `?`; verify every default keybinding is listed.
- [ ] Toggle detail visibility with `Ctrl+/`; verify the list expands and restores.
- [ ] Press `Tab`; verify focus cycles between list and detail.
- [ ] In detail focus, scroll with `Ctrl+f` and `Ctrl+b`.
- [ ] Toggle multi-select with `Space`; verify the footer count and selected row markers update.
- [ ] Select all visible rows with `Ctrl+a`, then clear selection with `Esc`.
- [ ] Trigger the destructive `Archive selected` action with `a`; cancel with `n`, then trigger it again and confirm with `y`.
- [ ] Reorder rows with `Ctrl+Up` and `Ctrl+Down`; verify the row order changes and remains stable.
- [ ] Quit with `q`; repeat with `Ctrl+c`.

## Slow Detail

- [ ] Start `npm run demo:explorer -- --mode single-detail-mode --slow-detail`.
- [ ] Move between rows and verify the detail pane shows the loading spinner after 150 ms before the 500 ms detail render completes.
- [ ] Repeat with `npm run demo:explorer -- --mode list-detail-mode --slow-detail`.

## Resize

- [ ] While interacting, resize the terminal from wide to medium to narrow and back.
- [ ] Verify there is no visible flicker, no overlapping text, and the layout reflows correctly.
- [ ] Confirm both detail modes still accept movement, filtering, help, palette, multi-select, destructive confirm, reorder, and quit after resizing.
