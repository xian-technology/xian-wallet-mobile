import { describe, expect, it } from "@jest/globals";

import { formatChiWithXian, unusedChiCost, unusedChiWarning } from "../unused-chi";

// Since execution revision 14 a paid transaction pays the chi it uses plus
// half of the chi it supplies but leaves unused (rounded down).
describe("unusedChiCost", () => {
  it("treats the SDK's 2-chi margin, and an odd 3, as no cost worth a warning", () => {
    expect(unusedChiCost({ supplied: 257, estimated: 255 })).toEqual({
      supplied: 257,
      estimated: 255,
      unused: 2,
      extraChi: 1,
      severity: "none",
    });
    expect(unusedChiCost({ supplied: 258, estimated: 255 })).toMatchObject({ extraChi: 1, severity: "none" });
  });

  it("warns when unused chi costs extra and escalates once the extra doubles the fee", () => {
    expect(unusedChiCost({ supplied: 601, estimated: 400 })).toMatchObject({ unused: 201, extraChi: 100, severity: "caution" });
    expect(unusedChiCost({ supplied: 1_200, estimated: 400 })).toMatchObject({ extraChi: 400, severity: "high" });
    expect(unusedChiCost({ supplied: 1_199, estimated: 400 })).toMatchObject({ extraChi: 399, severity: "caution" });
  });

  it("charges nothing extra for a short budget and refuses values that are not chi counts", () => {
    expect(unusedChiCost({ supplied: 200, estimated: 255 })).toMatchObject({ unused: 0, extraChi: 0, severity: "none" });
    for (const [supplied, estimated] of [[1.5, 1], [0, 10], [10, 0], [-1, 5]]) {
      expect(unusedChiCost({ supplied, estimated })).toBeNull();
    }
  });
});

describe("unusedChiWarning", () => {
  it("names the unused chi and the extra cost in chi and XIAN", () => {
    expect(unusedChiWarning(unusedChiCost({ supplied: 600, estimated: 400 })!, 20)).toBe(
      "This chi limit leaves 200 chi unused. Half of unused chi is charged: about 100 (~5 XIAN) more than the call needs (400 chi)."
    );
  });

  it("frames a budget that at least doubles the fee as an overpayment", () => {
    expect(unusedChiWarning(unusedChiCost({ supplied: 50_000, estimated: 312 })!, 20)).toBe(
      `This chi limit is ${(160).toLocaleString()}x what the call needs (312 chi). ` +
        `Half of unused chi is charged: about ${(24_844).toLocaleString()} (~${(1_242.2).toLocaleString()} XIAN) extra.`
    );
  });

  it("says nothing within the margin", () => {
    expect(unusedChiWarning(unusedChiCost({ supplied: 257, estimated: 255 })!, 20)).toBeNull();
  });
});

describe("formatChiWithXian", () => {
  it("adds the XIAN cost when the rate is known", () => {
    expect(formatChiWithXian(500, 25)).toBe("500 (~20 XIAN)");
    expect(formatChiWithXian(500, null)).toBe("500");
    expect(formatChiWithXian(null, 25)).toBe("Not provided");
    // A limit beyond the safe-integer range stays exact, without a cost.
    expect(formatChiWithXian(2n ** 60n, 25)).toBe((2n ** 60n).toLocaleString());
  });
});
