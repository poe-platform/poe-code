import type {
  ProviderService,
  ServiceExecutionContext,
  ServiceRunOptions
} from "../src/cli/service-registry.js";

export function createProviderStub<
  ConfigureOptions = unknown,
  UnconfigureOptions = ConfigureOptions,
  SpawnOptions = unknown
>(
  overrides: Partial<
    ProviderService<ConfigureOptions, UnconfigureOptions, SpawnOptions>
  > &
    Pick<ProviderService<ConfigureOptions, UnconfigureOptions, SpawnOptions>, "name" | "label"> &
    Partial<Pick<ProviderService, "id" | "summary">>
): ProviderService<ConfigureOptions, UnconfigureOptions, SpawnOptions> {
  const id = overrides.id ?? overrides.name;
  const summary = overrides.summary ?? overrides.label;

  const defaultConfigure = async (
    _context: ServiceExecutionContext<ConfigureOptions>,
    _runOptions?: ServiceRunOptions
  ): Promise<void> => {};

  const defaultUnconfigure = async (
    _context: ServiceExecutionContext<UnconfigureOptions>,
    _runOptions?: ServiceRunOptions
  ): Promise<boolean> => false;

  return {
    ...overrides,
    id,
    summary,
    configure: overrides.configure ?? defaultConfigure,
    unconfigure: overrides.unconfigure ?? defaultUnconfigure
  };
}
