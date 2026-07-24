# Explorer TUI overhaul QA

Run from the repository root in a real terminal. Use terminal-pilot for keystrokes, captures, and resizing; record each observed result.

1. Run `npm run build`, then `node dist/bin.cjs plan`. Confirm the frame appears immediately with a loading spinner and resolves to plan rows without a full-screen flash.
2. Type `gaslight`. Confirm every character appears in the filter and no edit, archive, delete, or save action runs.
3. Press Backspace eight times and type `read`. Confirm `e`, `a`, and `d` remain literal filter input.
4. Press Enter. Confirm the action menu lists Edit, Save/restore, Archive, and Delete. Press Escape and confirm only the menu closes.
5. Press Ctrl+E, quit the editor, and confirm the explorer restores without frames written over the editor.
6. Press Tab. Confirm Preview receives the heavy focus border. Scroll with the wheel and Down; confirm the percentage reaches the true final line.
7. Resize to 70×20. Confirm only the focused pane remains, including its right border and the footer. Press Tab to show the other pane, then restore the original size.
8. In tmux or over SSH, hold Down for three seconds. Confirm the explorer does not exit, no `A` characters enter the filter, and the cursor retains a three-row bottom margin.
9. Run `node dist/bin.cjs stash browse`. Confirm both list panes load through the shared explorer, Tab changes focus, Space selects, and Enter opens the action menu.
10. Press Ctrl+C from each explorer and confirm terminal modes, cursor, wrapping, paste, and mouse reporting are restored.

Capture the final plan and stash screens and note any terminal, tmux, or SSH versions used.
