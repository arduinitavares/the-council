/**
 * @fileoverview Council Engine Configuration Loader and Validator.
 * ESM Module (Node >= 22). Zero external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../types.js';

/**
 * Validates a Council configuration object.
 * @param {Object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object.'] };
  }

  if (typeof config.topic !== 'string' || !config.topic.trim()) {
    errors.push('Topic must be a non-empty string.');
  }

  if (typeof config.maxRounds !== 'number' || config.maxRounds < 1 || !Number.isInteger(config.maxRounds)) {
    errors.push('maxRounds must be an integer >= 1.');
  }

  if (typeof config.minQuorum !== 'number' || config.minQuorum < 1 || !Number.isInteger(config.minQuorum)) {
    errors.push('minQuorum must be an integer >= 1.');
  }

  if (typeof config.maxClarificationBatches !== 'number' || config.maxClarificationBatches < 0) {
    errors.push('maxClarificationBatches must be an integer >= 0.');
  }

  if (typeof config.maxRetriesPerSeat !== 'number' || config.maxRetriesPerSeat < 0) {
    errors.push('maxRetriesPerSeat must be an integer >= 0.');
  }

  if (config.judge) {
    if (!config.judge.id || typeof config.judge.id !== 'string') {
      errors.push('Judge requires a valid "id" string.');
    }
    if (!config.judge.harness || typeof config.judge.harness !== 'string') {
      errors.push('Judge requires a valid "harness" string.');
    }
  }

  if (config.seats) {
    if (!Array.isArray(config.seats)) {
      errors.push('Seats must be an array of Seat definitions.');
    } else {
      if (config.seats.length < (config.minQuorum || 2)) {
        errors.push(`Configured seats (${config.seats.length}) below minQuorum (${config.minQuorum || 2}).`);
      }
      const seenIds = new Set();
      config.seats.forEach((s, idx) => {
        if (!s || typeof s !== 'object') {
          errors.push(`Seat at index ${idx} is not an object.`);
          return;
        }
        if (!s.id || typeof s.id !== 'string' || !s.id.trim()) {
          errors.push(`Seat at index ${idx} missing valid "id".`);
        } else if (seenIds.has(s.id)) {
          errors.push(`Duplicate seat ID "${s.id}" detected.`);
        } else {
          seenIds.add(s.id);
        }
        if (!s.harness || typeof s.harness !== 'string') {
          errors.push(`Seat "${s.id || idx}" missing valid "harness".`);
        }
        if (!s.model || typeof s.model !== 'string') {
          errors.push(`Seat "${s.id || idx}" missing valid "model".`);
        }
        if (!s.soul || (typeof s.soul !== 'string' && typeof s.soul !== 'object')) {
          errors.push(`Seat "${s.id || idx}" missing valid "soul".`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Merges partial config with default values and normalizes options.
 * @param {Object} [userConfig={}]
 * @returns {Object} Normalized CouncilConfig
 */
export function resolveConfig(userConfig = {}) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    judge: {
      id: 'judge-astra',
      harness: 'codex',
      model: 'gpt-6-astra (max)',
      soul: 'Impartial Proof Auditor: admits only scoped, sourced proofs and synthesizes context-partitioned candidates without adding personal claims.',
      ...(userConfig.judge || {})
    },
    seats: userConfig.seats ? [...userConfig.seats] : [
      { id: 'astra-kernel', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Systems & Kernel Purist: focuses on container density, cgroups v2, and headless uptime.' },
      { id: 'astra-gamer', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'Desktop Gaming Enthusiast: focuses on DirectX 12, kernel anti-cheat, and frame pacing.' },
      { id: 'argon-unix', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Staff Mobile & Full-Stack Dev: focuses on POSIX shell, Xcode/iOS SDKs, and ARM efficiency.' }
    ]
  };

  const validation = validateConfig(merged);
  if (!validation.valid) {
    throw new Error(`Invalid Council configuration: ${validation.errors.join('; ')}`);
  }

  return Object.freeze(merged);
}

/**
 * Loads and resolves configuration from a JSON file.
 * @param {string} filePath
 * @param {Object} [overrides={}]
 * @returns {Object} Normalized CouncilConfig
 */
export function loadConfigFile(filePath, overrides = {}) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: "${resolvedPath}"`);
  }
  const content = fs.readFileSync(resolvedPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Malformed JSON in configuration file "${resolvedPath}": ${err.message}`);
  }
  return resolveConfig({ ...parsed, ...overrides });
}
