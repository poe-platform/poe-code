import { describe, expect, it } from "vitest";
import { hasTaskBoard, parseTaskBoard } from "./tasks.js";

describe("parseTaskBoard", () => {
  it("parses a task board with mixed checked and unchecked items", () => {
    const body = `# Plan

## Task Board

- [ ] First open task
- [x] Completed task
- [ ] Second open task

## Notes

Ignore this section.
`;

    expect(parseTaskBoard(body)).toEqual({
      tasks: [
        { text: "First open task", done: false },
        { text: "Completed task", done: true },
        { text: "Second open task", done: false }
      ],
      allDone: false,
      openCount: 2,
      doneCount: 1
    });
  });

  it("returns allDone=true when all tasks are checked", () => {
    const body = `## Task Board

- [x] Ship the feature
- [x] Update the docs
`;

    expect(parseTaskBoard(body).allDone).toBe(true);
  });

  it("returns allDone=false when any task is unchecked", () => {
    const body = `## Task Board

- [x] Ship the feature
- [ ] Update the docs
`;

    expect(parseTaskBoard(body).allDone).toBe(false);
  });

  it("counts open and done tasks correctly", () => {
    const body = `## Task Board

- [ ] First
- [x] Second
- [x] Third
- [ ] Fourth
`;

    expect(parseTaskBoard(body)).toMatchObject({
      openCount: 2,
      doneCount: 2
    });
  });

  it("throws when the Task Board heading is missing", () => {
    const body = `## Overview

- [ ] Missing task board heading
`;

    expect(() => parseTaskBoard(body)).toThrow(/Task Board/i);
  });

  it("handles an empty task board", () => {
    const body = `## Task Board

No tasks yet.
`;

    expect(parseTaskBoard(body)).toEqual({
      tasks: [],
      allDone: true,
      openCount: 0,
      doneCount: 0
    });
  });

  it("ignores checkbox items after the Task Board section ends", () => {
    const body = `## Task Board

- [ ] First task

## Notes

- [x] Not part of the task board
`;

    expect(parseTaskBoard(body)).toEqual({
      tasks: [{ text: "First task", done: false }],
      allDone: false,
      openCount: 1,
      doneCount: 0
    });
  });

  it("keeps tasks in top-to-bottom priority order", () => {
    const body = `## Task Board

- [x] Already done
- [ ] Highest priority open task
- [ ] Lower priority open task
`;

    const taskBoard = parseTaskBoard(body);
    const firstOpenTask = taskBoard.tasks.find((task) => !task.done);

    expect(firstOpenTask).toEqual({
      text: "Highest priority open task",
      done: false
    });
  });

  it("collects nested checkbox items in top-to-bottom order", () => {
    const body = `## Task Board

- [ ] Parent task
  - [x] Finished subtask
  - [ ] Open subtask
- [ ] Final task
`;

    expect(parseTaskBoard(body).tasks).toEqual([
      { text: "Parent task", done: false },
      { text: "Finished subtask", done: true },
      { text: "Open subtask", done: false },
      { text: "Final task", done: false }
    ]);
  });
});

describe("hasTaskBoard", () => {
  it("returns true when the body contains a Task Board heading", () => {
    const body = `# Plan

## Task Board

- [ ] One task
`;

    expect(hasTaskBoard(body)).toBe(true);
  });

  it("returns false when the body does not contain a Task Board heading", () => {
    const body = `# Plan

## Notes

- [ ] One task
`;

    expect(hasTaskBoard(body)).toBe(false);
  });

  it("returns false for a level-one Task Board heading", () => {
    const body = `# Task Board

- [ ] One task
`;

    expect(hasTaskBoard(body)).toBe(false);
  });
});
