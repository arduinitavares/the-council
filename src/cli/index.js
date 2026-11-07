#!/usr/bin/env node

/**
 * @fileoverview The Council — CLI Entry Point (`bin/council`).
 * ESM Module (Node >= 22). Zero external dependencies.
 * Uses native `node:util.parseArgs` for argument parsing.
 *
 * Supported Commands:
 * - council run [options]       : Runs a debate with specified or default config.
 * - council demo [name]         : Runs one of the 3 canonical prototype walkthroughs.
 * - council inspect <file>      : Inspects a recorded trajectory snapshot JSON.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { CouncilEngine } from '../engine/council-engine.js';
import { loadConfigFile, resolveConfig } from '../engine/config.js';
import { deserializeSnapshot } from '../telemetry/snapshot.js';

export const HELP_TEXT = `
The Council — Multi-Agent Consensus Deliberation Engine (v0.1.0)

Usage:
  council run [options]
  council demo [wt-better-os | wt-10-seats-quota | wt-opus-guardrails]
  council inspect <snapshot-file.json>

Options:
  -c, --config <path>    Path to JSON configuration file
  -t, --topic <string>   Debate topic problem statement
  -r, --rounds <number>  Maximum deliberation rounds (default: 3)
  -q, --quorum <number>  Minimum quorum of active seats (default: 2)
  -m, --mock             Run in hermetic deterministic mock mode (default)
      --json             Output result strictly as JSON
  -v, --verbose          Print real-time observer telemetry events to stderr
  -h, --help             Show this help message
  -V, --version          Show version
`;

/**
 * Runs the CLI command with the given argument list.
 * @param {string[]} [rawArgs]
 * @param {Object} [io]
 * @param {Object} [io.stdout]
 * @param {Object} [io.stderr]
 * @param {Function} [io.exit]
 * @returns {Promise<number>} exit code
 */
export async function runCli(rawArgs = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const exit = io.exit || ((code) => process.exit(code));

  const log = (...msg) => stdout.write(msg.join(' ') + '\n');
  const logErr = (...msg) => stderr.write(msg.join(' ') + '\n');

  // Command detection
  const command = rawArgs[0] && !rawArgs[0].startsWith('-') ? rawArgs[0] : 'run';
  const flagArgs = command === rawArgs[0] ? rawArgs.slice(1) : rawArgs;

  let parsed;
  try {
    parsed = parseArgs({
      args: flagArgs,
      options: {
        config: { type: 'string', short: 'c' },
        topic: { type: 'string', short: 't' },
        rounds: { type: 'string', short: 'r' },
        quorum: { type: 'string', short: 'q' },
        mock: { type: 'boolean', short: 'm', default: true },
        json: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'V', default: false }
      },
      allowPositionals: true
    });
  } catch (err) {
    logErr(`CLI argument error: ${err.message}\n`);
    logErr(HELP_TEXT);
    return exit(1) ?? 1;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    log(HELP_TEXT);
    return exit(0) ?? 0;
  }

  if (values.version) {
    log('the-council v0.1.0 (Node ' + process.version + ')');
    return exit(0) ?? 0;
  }

  if (command === 'inspect') {
    const filePath = positionals[0] || values.config;
    if (!filePath) {
      logErr('Error: "council inspect" requires a path to a snapshot JSON file.');
      return exit(1) ?? 1;
    }
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
      logErr(`Error: Snapshot file not found: "${resolved}"`);
      return exit(1) ?? 1;
    }
    const content = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(content);
    const list = Array.isArray(data) ? data : Array.isArray(data?.snapshots) ? data.snapshots : null;
    if (list) {
      log(`Trajectory contains ${list.length} snapshots:`);
      list.forEach((s) => {
        log(`  [${s.sequence}] ${s.event?.type || 'EVENT'} -> Phase: ${s.metrics?.phase} (Round ${s.metrics?.round})`);
      });
    } else {
      const snap = deserializeSnapshot(content);
      log(`Snapshot ID: ${snap.id}`);
      log(`Event: ${snap.event?.type}`);
      log(`Phase: ${snap.metrics?.phase} (Round ${snap.metrics?.round})`);
      log(`Active Seats: ${snap.metrics?.activeSeatCount}`);
      log(`Verdict: ${snap.metrics?.verdictKind || 'None'}`);
    }
    return exit(0) ?? 0;
  }

  if (command === 'demo') {
    const demoId = positionals[0] || 'wt-better-os';
    const wtPath = path.resolve(new URL('.', import.meta.url).pathname, '../visualizer/council-walkthroughs.js');
    const imported = await import(wtPath);
    const protoWalkthroughs = imported.default || globalThis.CouncilWalkthroughs || imported;
    const wts = protoWalkthroughs.WALKTHROUGHS || [];
    const wt = wts.find((w) => w.id === demoId);
    if (!wt) {
      logErr(`Unknown demo walkthrough "${demoId}". Available: wt-better-os, wt-10-seats-quota, wt-opus-guardrails`);
      return exit(1) ?? 1;
    }

    if (!values.json) {
      log(`\n=== Running Demo Walkthrough: ${wt.title} ===\n`);
      log(`Topic: ${wt.initialConfig.topic}\n`);
    }

    const engine = new CouncilEngine(wt.initialConfig);
    if (values.verbose) {
      engine.getTelemetry().on('seat_telemetry', (t) => {
        logErr(`[TELEMETRY] Seat "${t.seatId}" -> [${t.status.toUpperCase()}]`);
      });
      engine.getTelemetry().on('state_transition', (t) => {
        logErr(`[TRANSITION] ${t.event.type} -> ${t.state.phase} (Round ${t.state.round})`);
      });
    }

    // Run walkthrough steps manually
    engine.initRoster();
    for (const step of wt.steps) {
      if (values.verbose) logErr(`Step: ${step.label}`);
      if (step.event) {
        engine._step(step.event);
      } else if (step.multiEvents) {
        for (const ev of step.multiEvents) {
          engine._step(ev);
        }
      }
    }

    if (values.json) {
      log(JSON.stringify({
        id: wt.id,
        verdict: engine.state.verdict,
        state: engine.state,
        snapshots: engine.getTelemetry().getSnapshots()
      }, null, 2));
    } else {
      log('\n=== Final Verdict ===');
      log(`Kind: ${engine.state.verdict?.kind}`);
      log(`Note: ${engine.state.verdict?.note}\n`);
    }
    return exit(0) ?? 0;
  }

  if (command === 'run') {
    let cfg = {};
    if (values.config) {
      cfg = loadConfigFile(values.config);
    }
    if (values.topic) cfg.topic = values.topic;
    if (values.rounds) cfg.maxRounds = parseInt(values.rounds, 10);
    if (values.quorum) cfg.minQuorum = parseInt(values.quorum, 10);

    const resolved = resolveConfig(cfg);
    const engine = new CouncilEngine(resolved);

    if (values.verbose) {
      engine.getTelemetry().on('seat_telemetry', (t) => {
        logErr(`[TELEMETRY] Seat "${t.seatId}" -> [${t.status.toUpperCase()}]`);
      });
      engine.getTelemetry().on('state_transition', (t) => {
        logErr(`[TRANSITION] ${t.event.type} -> ${t.state.phase} (Round ${t.state.round})`);
      });
    }

    const result = await engine.run();

    if (values.json) {
      log(JSON.stringify(result, null, 2));
    } else {
      log('\n========================================');
      log('         THE COUNCIL — VERDICT          ');
      log('========================================');
      log(`Topic   : ${resolved.topic}`);
      log(`Verdict : ${result.verdict?.kind || 'No verdict emitted'}`);
      log(`Rounds  : ${result.state.round}`);
      log(`Seats   : ${result.state.seats.length} total (${result.verdict?.activeSeatCount || 0} active, ${result.verdict?.excusedSeatCount || 0} excused)`);
      if (result.verdict?.candidate) {
        log('\nCandidate Clauses:');
        result.verdict.candidate.clauses.forEach((c) => {
          log(`  - [${c.id || c.context}] ${c.context}: ${c.conclusion} (Cited: ${(c.citedProofIds || []).join(', ')})`);
        });
      }
      if (result.verdict?.unresolvedObjections?.length > 0) {
        log('\nUnresolved Objections:');
        result.verdict.unresolvedObjections.forEach((o) => {
          log(`  - [${o.id}] (${o.status}) Seat "${o.seatId}": ${o.reason} (Proof: ${o.proofId})`);
        });
      }
      log(`\nNote: ${result.verdict?.note || 'None'}`);
      log('========================================\n');
    }

    return exit(result.ok ? 0 : 2) ?? (result.ok ? 0 : 2);
  }

  logErr(`Unknown command "${command}". Run "council --help" for usage.`);
  return exit(1) ?? 1;
}

// Direct execution guard
const currentFile = path.resolve(new URL(import.meta.url).pathname);
const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === executedFile) {
  runCli().catch((err) => {
    console.error(`Fatal Council CLI error: ${err.stack || err.message}`);
    process.exit(1);
  });
}
