/**
 * Keeps rapidly changing node values compact and stable without changing the
 * full-precision value used by calculations or persistence.
 */
export function formatNodeNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  const magnitude = Math.abs(value);
  if (magnitude >= 10_000 || magnitude < 0.001) {
    const [mantissa, exponent] = value.toExponential(2).split("e");
    return `${Number(mantissa)}e${exponent}`;
  }

  return Number(value.toPrecision(4)).toString();
}

export const formatCycleTime = (seconds: number): string => `${formatNodeNumber(seconds)}s`;
