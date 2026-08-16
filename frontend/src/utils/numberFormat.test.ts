import { describe, expect, it } from "vitest";
import { formatCycleTime, formatNodeNumber } from "./numberFormat";

describe("node number formatting", () => {
  it("keeps computed cycle times compact", () => {
    expect(formatCycleTime(0.8336112037345782)).toBe("0.8336s");
    expect(formatCycleTime(2 / 1.33)).toBe("1.504s");
  });

  it("uses compact notation for extreme values", () => {
    expect(formatNodeNumber(0.000012345)).toBe("1.23e-5");
    expect(formatNodeNumber(123456)).toBe("1.23e+5");
  });
});
