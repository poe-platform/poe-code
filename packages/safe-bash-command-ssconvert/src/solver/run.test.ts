import { expect, it } from 'vitest';
import { solverAlgorithms } from './run.js';
it('lists released algorithms explicitly without host-dependent availability', () => {
  expect(solverAlgorithms).toEqual([
    { id: 'glpk', modelType: 'linear', available: true },
    { id: 'lpsolve', modelType: 'linear', available: true },
    { id: 'nlsolve', modelType: 'nonlinear', available: true }
  ]);
  expect(Object.isFrozen(solverAlgorithms)).toBe(true);
  expect(solverAlgorithms.every(Object.isFrozen)).toBe(true);
});
