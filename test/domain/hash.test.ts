import { describe, expect, it } from 'vitest';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';

describe('canonical artifact hashing', () => {
  it('sorts keys recursively while preserving arrays and exact strings', () => {
    expect(canonicalJson({ z: [2, 1], a: { y: ' x\n', a: null } })).toBe('{"a":{"a":null,"y":" x\\n"},"z":[2,1]}');
    expect(hashArtifact('candidate', { a: 1, b: 2 })).toBe(hashArtifact('candidate', { b: 2, a: 1 }));
    expect(hashArtifact('candidate', { a: 1, b: 2 })).toBe('1cbdcc6374b2f449147eaf683ee32b202fb0f6d1908d515abd0949839e1caa0c');
    expect(hashArtifact('candidate', [1, 2])).not.toBe(hashArtifact('candidate', [2, 1]));
    expect(hashArtifact('candidate', ' x')).not.toBe(hashArtifact('candidate', 'x'));
    expect(hashArtifact('evidence', 'x')).not.toBe(hashArtifact('candidate', 'x'));
  });
  it.each([undefined, NaN, Infinity, () => 1, new Date(), { a: undefined }, [undefined], 1n])('rejects non-JSON input %s', value => {
    expect(() => hashArtifact('input', value as never)).toThrow();
  });
  it('rejects cycles, sparse arrays and symbol-bearing objects', () => {
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    expect(() => canonicalJson(cycle as never)).toThrow();
    expect(() => canonicalJson(Array(2) as never)).toThrow();
    expect(() => canonicalJson({ [Symbol('secret')]: 1 } as never)).toThrow();
  });
  it('rejects hidden non-JSON properties and array accessors without executing them', () => {
    expect(() => canonicalJson(Object.defineProperty({}, 'hidden', { value: undefined }))).toThrow();
    let called = false;
    const array = [1]; Object.defineProperty(array, '0', { get: () => { called = true; return 1; } });
    expect(() => canonicalJson(array)).toThrow();
    expect(called).toBe(false);
  });
});
