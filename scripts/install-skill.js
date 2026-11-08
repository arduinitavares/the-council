#!/usr/bin/env node
/**
 * @fileoverview Copies skills/ask-council/SKILL.md to workspace (.agents/skills/ask-council/SKILL.md)
 * and user (~/.agents/skills/ask-council/SKILL.md) skill directories as real files (never symlinks).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_SKILL_PATH = path.join(PACKAGE_ROOT, 'skills', 'ask-council', 'SKILL.md');

/**
 * Copies the ask-council SKILL.md to workspace and user skill roots using fs.copyFileSync.
 *
 * @param {Object} [options={}]
 * @param {string} [options.userSkillsRoot] - Override for `~/.agents/skills`
 * @param {string} [options.workspaceSkillsRoot] - Override for `<PACKAGE_ROOT>/.agents/skills`
 * @returns {{ sourcePath: string, installedPaths: string[] }}
 */
export function installSkill(options = {}) {
  if (!fs.existsSync(SOURCE_SKILL_PATH)) {
    throw new Error(`Source skill file not found: ${SOURCE_SKILL_PATH}`);
  }

  const workspaceRoot = options.workspaceSkillsRoot
    ? path.resolve(options.workspaceSkillsRoot)
    : path.join(PACKAGE_ROOT, '.agents', 'skills');

  const userRoot = options.userSkillsRoot
    ? path.resolve(options.userSkillsRoot)
    : path.join(os.homedir(), '.agents', 'skills');

  const targetDirs = [
    path.join(workspaceRoot, 'ask-council'),
    path.join(userRoot, 'ask-council')
  ];

  const installedPaths = [];
  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });
    const destFile = path.join(dir, 'SKILL.md');
    try {
      const stat = fs.lstatSync(destFile);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(destFile);
      }
    } catch {
      // Destination does not exist yet
    }
    fs.copyFileSync(SOURCE_SKILL_PATH, destFile);
    installedPaths.push(destFile);
  }

  return {
    sourcePath: SOURCE_SKILL_PATH,
    installedPaths
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { installedPaths } = installSkill();
  for (const p of installedPaths) {
    process.stdout.write(`Installed skill: ${p}\n`);
  }
}
