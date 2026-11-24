import { describe, expect, it } from "vitest";
import { accountError, quotaError } from "./account";

describe("accountError", () => {
  it("tells the errors of the account from those of a model", () => {
    expect(accountError(401, "")).toContain("invalid OpenRouter key");
    expect(accountError(402, "")).toContain("credits");
    expect(accountError(429, "Rate limit exceeded: free-models-per-day. Add 10 credits")).toContain("daily quota");
    expect(accountError(429, "temporarily rate-limited upstream", 0)).toContain("daily quota");
    // a busy provider, or a model no longer free: the next models may answer
    expect(accountError(429, "temporarily rate-limited upstream", 12)).toBeNull();
    expect(accountError(429, "temporarily rate-limited upstream")).toBeNull();
    expect(accountError(404, "This model is unavailable for free")).toBeNull();
    expect(accountError(500, "")).toBeNull();
  });
});

describe("quotaError", () => {
  it("is an error with fewer free requests left than a run needs", () => {
    expect(quotaError(3)).toBe("3 free requests left today: nothing evaluated");
    expect(quotaError(4)).toBeNull();
  });
});
