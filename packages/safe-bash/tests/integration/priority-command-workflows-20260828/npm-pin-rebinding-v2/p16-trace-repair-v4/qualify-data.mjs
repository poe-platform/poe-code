import { assertTraceStages, assertExactData, assertFutureBudget } from './stage-helper.mjs';
export function qualifyData(controls, row, expectedGrant, oldGrant, newBudget, oldBudget) {
  const result = { role: 'ONE_FINITE_DATA_QUALIFICATION_NOT_RUNTIME', originalNine: [], additionalObservable: [], bindingControls: [] };
  const run = (name, expected, action) => {
    let actual = true, rejection = null;
    try { action(); } catch (error) { actual = false; rejection = { name: error.name, message: error.message, stack: error.stack }; }
    return { name, expected, actual, pass: actual === expected, rejection };
  };
  for (const control of controls.originalNine) result.originalNine.push(run(control.name, control.expected, () => assertTraceStages(row, control.stages)));
  for (const control of controls.additionalObservable) result.additionalObservable.push(run(control.name, control.expected, () => assertTraceStages(row, control.stages)));
  result.bindingControls.push(run('old_GO_rejected', false, () => assertExactData(oldGrant, expectedGrant)));
  result.bindingControls.push(run('inactive_new_budget_DATA', true, () => assertFutureBudget(newBudget)));
  result.bindingControls.push(run('old_budget_rejected', false, () => assertFutureBudget(oldBudget)));
  const wrongRoot = JSON.parse(JSON.stringify(expectedGrant)); wrongRoot.root = oldGrant.root;
  result.bindingControls.push(run('old_root_rejected', false, () => assertExactData(wrongRoot, expectedGrant)));
  const wrongSelection = JSON.parse(JSON.stringify(expectedGrant)); wrongSelection.selection[0] = 'source-build:P01';
  result.bindingControls.push(run('wrong_selection_rejected', false, () => assertExactData(wrongSelection, expectedGrant)));
  result.pass = [...result.originalNine, ...result.additionalObservable, ...result.bindingControls].every(control => control.pass);
  return result;
}
