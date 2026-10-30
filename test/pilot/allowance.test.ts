import { expect, it } from "vitest";
import { readFailure } from "../../src/pilot/allowance.js";

it("retains a named timeout diagnostic without account strings", () => {
  const error = Object.assign(new Error("Request timed out for secret-account@example.test"), { code: "ETIMEDOUT" });
  const result = readFailure("Orca accounts.list(refreshUsage=true)", error);
  expect(result.state).toBe("missing");
  expect(JSON.parse(result.detail)).toMatchObject({ diagnostic: { class: "timeout", code: "ETIMEDOUT" } });
  expect(JSON.stringify(result)).not.toContain("secret-account");
});

it("keeps authentication and denial separate from transport failures", () => {
  expect(readFailure("accounts.list", { code: 401 }).state).toBe("authentication_failed");
  expect(readFailure("accounts.list", { code: "permission_denied" }).state).toBe("denied");
  const result = readFailure("accounts.list", Object.assign(new Error("private detail"), { code: "ECONNRESET" }));
  expect(JSON.parse(result.detail)).toMatchObject({ diagnostic: { class: "transport", code: "ECONNRESET" } });
  expect(result.state).toBe("missing");
});
it("retains the official RuntimeClient runtime_timeout code", () => {
  const result = readFailure("Orca accounts.list(refreshUsage=true)", { code: "runtime_timeout", message: "private-account" });
  expect(JSON.parse(result.detail)).toMatchObject({ diagnostic: { class: "timeout", code: "runtime_timeout" } });
});
