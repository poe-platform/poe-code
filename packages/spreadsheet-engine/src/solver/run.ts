import { runCooperatively } from "../cooperative.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { loadSolverParameters, validateSolverParametersSteps, selectSolverAlgorithm, type SolverAlgorithm } from "./model.js";
import { SolverBudget, solveLinearSteps } from "./linear.js";
import { SolverProgram } from "./program.js";
import { solveNonlinearSteps } from "./nonlinear.js";
import { linearSensitivitySteps, type Sensitivity } from "./sensitivity.js";
import { createProgramReport, createSensitivityReport } from "./report.js";
export const solverAlgorithms: readonly SolverAlgorithm[] = Object.freeze([
  Object.freeze({ id: 'glpk', modelType: 'linear', available: true }),
  Object.freeze({ id: 'lpsolve', modelType: 'linear', available: true }),
  Object.freeze({ id: 'nlsolve', modelType: 'nonlinear', available: true })
]);
export async function runSolverValidation(book: Workbook, context: CapabilityContext, registry: readonly SolverAlgorithm[] = solverAlgorithms): Promise<Workbook> {
  const model = loadSolverParameters(book, context);
  const algorithm = selectSolverAlgorithm(model, registry);
  const warning = async (message: string) => { await context.diagnostic?.({ code: 'solver-validation', severity: 'warning', message }); context.signal.throwIfAborted(); };
  const error = await runCooperatively(validateSolverParametersSteps(book, model, context), context.signal);
  if (error) { await warning(`Solver: ${error}`); return book; }
  if (!algorithm) { await warning('Solver: Failed to create solver'); return book; }
  const budget = new SolverBudget(context, algorithm.id === 'nlsolve' ? Math.max(1, model.options.maximumIterations) : Infinity, Infinity);
  const program = new SolverProgram(book, model, context, budget);
  let sensitivity: Sensitivity | undefined;
  let reportSolution: readonly number[] | undefined, reportedValue: number | undefined;
  let solution: readonly number[] | undefined, quality: 'Optimal' | 'Feasible' | undefined;
  try {
    if (algorithm.id === 'nlsolve') {
      const result = await runCooperatively(solveNonlinearSteps(program), context.signal);
      if (typeof result === 'string') { await warning(`Solver: ${result}`); return book; }
      solution = result.solution; quality = 'Feasible';
      if (result.limited) await warning('Solver reached time or iteration limit');
    } else {
      const linear = await runCooperatively(program.linearizeSteps(), context.signal);
      const ordinaryRows = program.parts.reduce((count, p) => count + (p.relation < 8 ? p.relation === 4 ? 2 : 1 : 0), 0);
      if (algorithm.id === 'glpk' && (ordinaryRows === 0 || linear.rows.slice(0, ordinaryRows).some(r => r.coefficients.every(v => v === 0)))) {
        await warning('Solver: Solver ran, but failed'); return book;
      }
      const result = await runCooperatively(solveLinearSteps(linear.rows, linear.objective, model.domains, budget), context.signal);
      solution = result.quality === 'infeasible' || result.quality === 'unbounded' ? undefined : result.solution;
      if (algorithm.id === 'glpk' && model.options.sensitivityReport && (result.quality === 'infeasible' || result.quality === 'unbounded' || model.domains.some(d => d !== 'continuous'))) { await warning('Solver: Solver ran, but failed'); return book; }
      if (result.quality === 'infeasible' || result.quality === 'unbounded') { reportSolution = model.variables.map(() => 0); reportedValue = 0; }
      if (result.quality === 'limit') { await warning('Solver reached time or iteration limit'); quality = solution ? 'Feasible' : undefined; }
      else if (result.quality === 'optimal') {
        quality = algorithm.id === 'glpk' && model.domains.every(d => d === 'continuous') ? 'Feasible' : 'Optimal';
        if (model.options.sensitivityReport && solution && model.domains.every(d => d === 'continuous')) sensitivity = await runCooperatively(linearSensitivitySteps(linear.rows, linear.objective, solution, budget), context.signal);
      }
    }
  } catch (error) {
    if (!(error instanceof SsconvertError) || error.code !== 'invalid-request') throw error;
    await warning(`Solver: ${error.message}`); return book;
  }
  // Native services run only after a solver starts, not during admission. The
  // portable solver has already captured/computed its model; process the host
  // batch before applying results and recalculating the current datasource values.
  if (context.datasource) await context.datasource.poll(program.book);
  let result = await runCooperatively(program.applySteps(solution), context.signal);
  if (model.options.programReport && (solution || reportSolution)) result = createProgramReport(program, result, solution ?? reportSolution!, quality, reportedValue);
  if (model.options.sensitivityReport && solution && sensitivity) result = createSensitivityReport(program, result, solution, sensitivity, algorithm.id === 'lpsolve' ? 'lpsolve' : 'glpk');
  return result;
}
