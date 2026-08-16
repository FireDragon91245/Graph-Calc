export const setModuleSlotCount = (
  slots: Array<string | null>,
  moduleId: string,
  requestedCount: number
): Array<string | null> => {
  const targetCount = Math.max(0, Math.floor(requestedCount));
  const next = [...slots];
  const installed = next.flatMap((candidate, index) => candidate === moduleId ? [index] : []);

  if (targetCount < installed.length) {
    for (const index of installed.slice(targetCount)) next[index] = null;
    return next;
  }

  let remaining = targetCount - installed.length;
  for (let index = 0; index < next.length && remaining > 0; index += 1) {
    if (next[index] !== null) continue;
    next[index] = moduleId;
    remaining -= 1;
  }
  while (remaining > 0) {
    next.push(moduleId);
    remaining -= 1;
  }
  return next;
};
