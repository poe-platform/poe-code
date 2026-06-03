import { describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  lstatSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('node:fs', () => fsMock);

import { rotateLogs } from './log-rotation.js';

describe('rotateLogs', () => {
  it('rejects a symbolic-link logs directory before deleting files', () => {
    fsMock.lstatSync.mockReturnValue({ isSymbolicLink: () => true });

    expect(() => rotateLogs('/logs', 1)).toThrow('symbolic link');
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
  });

  it('rejects non-finite retention limits without deleting logs', () => {
    fsMock.lstatSync.mockReturnValue({ isSymbolicLink: () => false });
    fsMock.readdirSync.mockReturnValue(['a.log', 'b.log']);
    fsMock.statSync.mockReturnValue({ mtime: new Date() });

    expect(() => rotateLogs('/logs', Number.NaN)).toThrow('finite non-negative integer');
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
  });

  it('counts only log files successfully deleted', () => {
    fsMock.lstatSync.mockReturnValue({ isSymbolicLink: () => false });
    fsMock.readdirSync.mockReturnValue(['new.log', 'old.log']);
    fsMock.statSync.mockImplementation((file: string) => ({
      mtime: new Date(file.endsWith('new.log') ? 2_000 : 1_000),
    }));
    fsMock.unlinkSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    expect(rotateLogs('/logs', 1)).toBe(0);
    expect(fsMock.unlinkSync).toHaveBeenCalledWith('/logs/old.log');
  });
});
