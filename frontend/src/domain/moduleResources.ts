import type { ModuleSystemResource } from "./moduleSystem";

export const resolveModuleSystemResource = (
  resources: ModuleSystemResource[],
  reference?: string
): ModuleSystemResource | undefined => {
  if (!reference) return undefined;
  return resources.find((candidate) => candidate.id === reference)
    ?? resources.find((candidate) => candidate.name === reference);
};
