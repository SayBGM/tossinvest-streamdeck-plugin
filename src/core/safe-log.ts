const SENSITIVE_KEYS = /(?:secret|token|authorization|client[_-]?id)/i;

function redact(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/\b(?:c|s)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  }
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, "", seen));
  const result: Record<string, unknown> = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    result[nestedKey] = redact(nestedValue, nestedKey, seen);
  }
  return result;
}

export function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return JSON.stringify({ event: "serialization_failed" });
  }
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? String(redact(error.message)) : String(redact(error));
}
