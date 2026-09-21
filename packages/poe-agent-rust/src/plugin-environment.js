const environment = (cwd) => ({
  name: "environment",
  prompt(ctx) {
    return {
      ...ctx,
      system: [ctx.system, `Working directory: ${cwd}`, `Node: ${process.version}`]
        .filter(Boolean)
        .join("\n")
    };
  }
});
export default environment;
