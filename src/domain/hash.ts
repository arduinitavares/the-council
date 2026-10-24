import { createHash } from 'node:crypto';
import type { JsonValue } from './contracts.js';

/** Validate before serialization: JSON.stringify alone silently loses invalid data. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new Error('Non-JSON value');
    if (ancestors.has(item)) throw new Error('Cyclic JSON value');
    ancestors.add(item);
    try {
      if (Object.getOwnPropertySymbols(item).length) throw new Error('Non-JSON symbol keys');
      if (Array.isArray(item)) {
        if (Object.getOwnPropertyNames(item).length !== item.length + 1) throw new Error('Sparse or extended JSON array');
        const entries: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const property = Object.getOwnPropertyDescriptor(item, String(index));
          if (!property || !property.enumerable || !('value' in property)) throw new Error('Non-JSON array property');
          entries.push(encode(property.value));
        }
        return `[${entries.join(',')}]`;
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('Non-JSON object');
      const record = item as Record<string, unknown>;
      return `{${Object.getOwnPropertyNames(record).sort().map(key => {
        const property = Object.getOwnPropertyDescriptor(record, key);
        if (!property || !property.enumerable || !('value' in property)) throw new Error('Non-JSON object property');
        return `${JSON.stringify(key)}:${encode(property.value)}`;
      }).join(',')}}`;
    } finally { ancestors.delete(item); }
  };
  return encode(value);
}

export function hashArtifact(kind: string, value: JsonValue): string {
  if (!/^[A-Za-z0-9_-]+$/.test(kind)) throw new Error('Invalid artifact kind');
  const canonical = canonicalJson(value);
  return createHash('sha256').update(`council:v1:${kind}\n`, 'utf8').update(canonical, 'utf8').digest('hex');
}
