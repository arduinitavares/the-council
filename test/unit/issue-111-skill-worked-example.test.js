import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkill } from '../../scripts/install-skill.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE_SKILL_PATH = path.join(REPO_ROOT, 'skills', 'ask-council', 'SKILL.md');
const MIRROR_SKILL_PATH = path.join(REPO_ROOT, '.agents', 'skills', 'ask-council', 'SKILL.md');

const EXPECTED_STEP_1_SECTION = [
  '### Step 1: Formulate Command',
  'Using a built-in preset (works from any working directory):',
  '```bash',
  '/Users/aaat/projects/the-council/bin/council run --live -p architecture -t "Should we migrate from REST to gRPC for service-to-service communication?" -v',
  '```',
  '',
  'Using a custom configuration file:',
  '```bash',
  '/Users/aaat/projects/the-council/bin/council run --live -c phone-council.json -v',
  '```'
].join('\n');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertRegularFile(filePath, label) {
  assert.ok(fs.existsSync(filePath), `${label} must exist`);
  const stat = fs.lstatSync(filePath);
  assert.equal(stat.isSymbolicLink(), false, `${label} must not be a symlink`);
  assert.equal(stat.isFile(), true, `${label} must be a regular file`);
}

function extractSection(markdown, startHeading, endHeading) {
  const startIdx = markdown.indexOf(startHeading);
  assert.notEqual(startIdx, -1, `Missing section heading: ${startHeading}`);
  const endIdx = markdown.indexOf(endHeading, startIdx + startHeading.length);
  assert.notEqual(endIdx, -1, `Missing following heading: ${endHeading}`);
  return markdown.slice(startIdx, endIdx).trimEnd();
}

describe('Issue #111: Worked gRPC load-balancing condition & skill mirror parity', () => {
  it('keeps skills/ask-council/SKILL.md and .agents/skills/ask-council/SKILL.md as regular files with identical SHA-256 digests', () => {
    assertRegularFile(SOURCE_SKILL_PATH, 'skills/ask-council/SKILL.md');
    assertRegularFile(MIRROR_SKILL_PATH, '.agents/skills/ask-council/SKILL.md');

    const sourceDigest = sha256File(SOURCE_SKILL_PATH);
    const mirrorDigest = sha256File(MIRROR_SKILL_PATH);
    assert.equal(
      mirrorDigest,
      sourceDigest,
      'skills/ask-council/SKILL.md and .agents/skills/ask-council/SKILL.md must have identical SHA-256 digests'
    );
  });

  it('installSkill copies skills/ask-council/SKILL.md byte-identically as real files into temp directories (replacing pre-existing symlinks)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'council-issue-111-'));
    const tmpWorkspaceRoot = path.join(tmpRoot, 'workspace-skills');
    const tmpUserRoot = path.join(tmpRoot, 'user-skills');

    try {
      // Seed a symlink at one destination to prove installSkill replaces symlinks with real files.
      const preExistingDir = path.join(tmpWorkspaceRoot, 'ask-council');
      fs.mkdirSync(preExistingDir, { recursive: true });
      fs.symlinkSync(SOURCE_SKILL_PATH, path.join(preExistingDir, 'SKILL.md'));

      const result = installSkill({
        workspaceSkillsRoot: tmpWorkspaceRoot,
        userSkillsRoot: tmpUserRoot
      });

      const expectedWorkspaceDest = path.join(tmpWorkspaceRoot, 'ask-council', 'SKILL.md');
      const expectedUserDest = path.join(tmpUserRoot, 'ask-council', 'SKILL.md');
      assert.deepEqual(result.installedPaths, [expectedWorkspaceDest, expectedUserDest]);

      const sourceBytes = fs.readFileSync(SOURCE_SKILL_PATH);
      const sourceDigest = sha256File(SOURCE_SKILL_PATH);

      for (const destPath of result.installedPaths) {
        assertRegularFile(destPath, destPath);
        assert.equal(sha256File(destPath), sourceDigest, `${destPath} SHA-256 must match source`);
        assert.equal(
          Buffer.compare(fs.readFileSync(destPath), sourceBytes),
          0,
          `${destPath} must be byte-identical to skills/ask-council/SKILL.md`
        );
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('aligns Final Answer, [C1], and [P4] in ## 5. Verdict Interpretation on L7 (request-level) or client-side load balancing and backend-hotspotting prevention', () => {
    const expectedPhrase = 'L7 (request-level) or client-side load balancing';

    for (const filePath of [SOURCE_SKILL_PATH, MIRROR_SKILL_PATH]) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(
        content.includes('L7 client-side load balancing'),
        false,
        `${filePath} must not contain stale "L7 client-side load balancing" phrasing`
      );

      const verdictSection = extractSection(
        content,
        '## 5. Verdict Interpretation',
        '### Verdict Kinds'
      );

      const finalAnswerMatch = verdictSection.match(/^Final Answer:\n([^\n]+)/m);
      assert.ok(finalAnswerMatch, `${filePath} must contain Final Answer block in Verdict Interpretation`);
      const finalAnswerLine = finalAnswerMatch[1];
      assert.ok(
        finalAnswerLine.includes(expectedPhrase),
        `Final Answer must include "${expectedPhrase}"`
      );
      assert.match(
        finalAnswerLine,
        /prevent .*backend hotspotting/i,
        'Final Answer must explain preventing backend hotspotting'
      );

      const c1Match = verdictSection.match(/^\s*- \[C1\][^\n]+/m);
      assert.ok(c1Match, `${filePath} must contain [C1] clause in Verdict Interpretation`);
      assert.ok(
        c1Match[0].includes(expectedPhrase),
        `[C1] must include "${expectedPhrase}"`
      );
      assert.match(
        c1Match[0],
        /prevent backend hotspotting/i,
        '[C1] must mention preventing backend hotspotting'
      );

      const p4Match = verdictSection.match(/^\s*- \[P4\][^\n]+/m);
      assert.ok(p4Match, `${filePath} must contain [P4] proof in Verdict Interpretation`);
      assert.ok(
        p4Match[0].includes(expectedPhrase),
        `[P4] must include "${expectedPhrase}"`
      );
      assert.match(
        p4Match[0],
        /prevent backend hotspotting/i,
        '[P4] must mention preventing backend hotspotting'
      );
    }
  });

  it('leaves ### Step 1: Formulate Command unchanged and free of any five-part decision-contract rubric', () => {
    for (const filePath of [SOURCE_SKILL_PATH, MIRROR_SKILL_PATH]) {
      const content = fs.readFileSync(filePath, 'utf8');
      const step1Section = extractSection(
        content,
        '### Step 1: Formulate Command',
        '### CLI Flag Reference'
      );

      assert.equal(
        step1Section,
        EXPECTED_STEP_1_SECTION,
        `${filePath} ### Step 1: Formulate Command must remain unchanged`
      );

      assert.doesNotMatch(
        step1Section,
        /decision[- ]contract|rubric|blast radius|reversibility|verification plan|1\.\s+.*\n\s*2\.\s+/i,
        '### Step 1: Formulate Command must remain free of any five-part decision-contract rubric'
      );
    }
  });
});
