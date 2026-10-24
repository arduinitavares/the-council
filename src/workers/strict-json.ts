import { createHash } from "node:crypto";

/** Recursive descent retains object member identity before JSON.parse can erase duplicates. */
export function decodeStrictJson(text: string): unknown {
  let at = 0;
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(text[at] ?? "") && at < text.length) at++;
  };
  const fail = (): never => {
    throw new Error("INVALID_STRICT_JSON");
  };
  const string = (): string => {
    if (text[at++] !== '"') return fail();
    const start = at - 1;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '"') {
        try {
          return JSON.parse(text.slice(start, at)) as string;
        } catch {
          return fail();
        }
      }
      if (ch === "\\") {
        if (at >= text.length) return fail();
        at++;
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 128) return fail();
    whitespace();
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === "{") {
      at++;
      whitespace();
      const obj: Record<string, unknown> = {},
        keys = new Set<string>();
      if (text[at] === "}") {
        at++;
        return obj;
      }
      while (at < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) return fail();
        keys.add(key);
        whitespace();
        if (text[at++] !== ":") return fail();
        Object.defineProperty(obj, key, {
          value: value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        whitespace();
        const end = text[at++];
        if (end === "}") return obj;
        if (end !== ",") return fail();
      }
      return fail();
    }
    if (ch === "[") {
      at++;
      whitespace();
      const arr: unknown[] = [];
      if (text[at] === "]") {
        at++;
        return arr;
      }
      while (at < text.length) {
        arr.push(value(depth + 1));
        whitespace();
        const end = text[at++];
        if (end === "]") return arr;
        if (end !== ",") return fail();
      }
      return fail();
    }
    for (const [token, parsed] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length;
        return parsed;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(at),
    );
    if (!number) return fail();
    at += number[0].length;
    const parsed = Number(number[0]);
    return Number.isFinite(parsed) ? parsed : fail();
  };
  const result = value(0);
  whitespace();
  if (at !== text.length) return fail();
  return result;
}
export interface NormalizationReceipt {
  operations: readonly ("whole-message-fence" | "trailing-commas")[];
  rawHash: string;
  normalizedHash: string;
  normalized: string;
  outcome: "valid" | "invalid";
  strictOutcome: "valid" | "invalid";
  value?: unknown;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function normalizeJsonSurface(raw: string): NormalizationReceipt {
  const operations: ("whole-message-fence" | "trailing-commas")[] = [];
  const receipt = (
    normalized: string,
    outcome: "valid" | "invalid",
    strictOutcome: "valid" | "invalid",
    value?: unknown,
  ): NormalizationReceipt => ({
    operations,
    rawHash: hash(raw),
    normalizedHash: hash(normalized),
    normalized,
    outcome,
    strictOutcome,
    ...(outcome === "valid" ? { value } : {}),
  });
  try {
    return receipt(raw, "valid", "valid", decodeStrictJson(raw));
  } catch {
    /* bounded local surface repair only */
  }
  let normalized = raw;
  const fence = /^```(?:json)?\r?\n([\s\S]*)\r?\n```$/.exec(
    raw.replace(/^[\x20\t\r\n]+|[\x20\t\r\n]+$/g, ""),
  );
  if (fence) {
    normalized = fence[1]!;
    operations.push("whole-message-fence");
  }
  let quoted = false,
    escaped = false,
    out = "",
    removed = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (quoted) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    if (ch === ",") {
      let next = i + 1;
      while (
        /[\x20\t\r\n]/.test(normalized[next] ?? "") &&
        next < normalized.length
      )
        next++;
      const prior = out.trimEnd().at(-1);
      if (
        (normalized[next] === "}" || normalized[next] === "]") &&
        prior &&
        !"[{:,".includes(prior)
      ) {
        removed = true;
        continue;
      }
    }
    out += ch;
  }
  if (removed) operations.push("trailing-commas");
  normalized = out;
  try {
    return receipt(
      normalized,
      "valid",
      "invalid",
      decodeStrictJson(normalized),
    );
  } catch {
    return receipt(normalized, "invalid", "invalid");
  }
}
