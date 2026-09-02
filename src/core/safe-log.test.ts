import { describe, expect, it } from "vitest";
import { safeSerialize } from "./safe-log.js";

describe("safe logging", () => {
  it("redacts credential-shaped keys and bearer tokens", () => {
    const output = safeSerialize({ clientSecret: "secret-value", authorization: "Bearer abc.def.ghi", nested: { token: "token-value" } });
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("token-value");
    expect(output).toContain("[REDACTED]");
  });
});
