export interface LanguageFinding {
  code: 'SENTENCE_LENGTH' | 'PASSIVE_VOICE' | 'TERM_CONSISTENCY' | 'SEMICOLON';
  severity: 'advisory';
  offset: number;
  text: string;
  message: string;
}

/** Issue 9-oriented surface advice only. No dictionary or technical verification. */
export function checkLanguageSurface(text: string, kind: 'description' | 'procedure'): LanguageFinding[] {
  const findings: LanguageFinding[] = [];
  // Preserve offsets and original input. Machine literals are outside this profile.
  const mask = (literal: string) => literal.replace(/[^\n]/g, ' ');
  let fence: { char: string; length: number } | null = null;
  const blocks = text.replace(/[^\n]*(?:\n|$)/g, line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence.char && marker.length >= fence.length && /^\s*$/.test(line.slice(line.indexOf(marker) + marker.length))) fence = null;
      return mask(line);
    }
    if (marker) { fence = { char: marker[0]!, length: marker.length }; return mask(line); }
    return line;
  });
  const prose = blocks.replace(/(`+)[^]*?\1|\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|(?:\/[\w.~-]+)+|\b\w*[_:]\w*\b/g, mask);
  const add = (code: LanguageFinding['code'], offset: number, length: number, message: string) => {
    findings.push({ code, severity: 'advisory', offset, text: text.slice(offset, offset + length), message });
  };
  const limit = kind === 'description' ? 25 : 20;
  for (const sentence of prose.matchAll(/[^.!?\n]+[.!?]?/g)) {
    const count = sentence[0].match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
    if (count > limit) add('SENTENCE_LENGTH', sentence.index, sentence[0].length, `${count} surface words exceed the ${limit}-word ${kind} target.`);
  }
  for (const match of prose.matchAll(/\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w+ed|built|known|shown|given|written|sent|made|seen|found|held|read)\b/gi)) {
    add('PASSIVE_VOICE', match.index, match[0].length, 'Check this possible passive construction. Use a known actor without inventing one.');
  }
  for (const match of prose.matchAll(/;/g)) add('SEMICOLON', match.index, 1, 'Use separate sentences when the meaning permits it.');
  for (const match of prose.matchAll(/\bvoters?\b/gi)) add('TERM_CONSISTENCY', match.index, match[0].length, 'Use reviewer for the stable Council seat.');
  return findings.sort((a, b) => a.offset - b.offset || a.code.localeCompare(b.code));
}
