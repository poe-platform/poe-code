import { DefaultReporter } from "vitest/node";

export default class ImmediateReporter extends DefaultReporter {
  constructor(options = {}, failuresOnly = false) {
    super(options);
    this.failuresOnly = failuresOnly;
  }
  printTestModule(module) {
    if (!this.failuresOnly || module.state() === "failed") super.printTestModule(module);
  }
  onTestModuleEnd(module) {
    super.onTestModuleEnd(module);
    if (module.state() !== "failed") return;
    for (const entity of [module, ...module.children.allSuites(), ...module.children.allTests("failed")]) {
      const errors = entity.type === "test" ? entity.result().errors : entity.errors();
      if (!errors?.length) continue;
      this.ctx.logger.error(`FAIL ${module.relativeModuleId}${entity === module ? "" : ` > ${entity.fullName}`}`);
      for (const error of errors) this.ctx.logger.printError(error, { project: entity.project });
    }
  }
}
