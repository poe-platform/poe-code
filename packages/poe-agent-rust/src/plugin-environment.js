const environment = (cwd) => ({
  name: "environment",
  prompt(ctx, runtime) {
    return {
      ...ctx,
      system: [ctx.system, `Working directory: ${runtime?.cwd ?? cwd}`, `Node: ${process.version}`]
        .filter(Boolean)
        .join("\n")
    };
  }
});
export default environment;
