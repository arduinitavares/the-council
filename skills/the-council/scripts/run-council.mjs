#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Canonicalize the script itself: a personal skill symlink is not a package root.
const packageRoot = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '../../..');
const native = process.argv[2] === 'native';
const cli = resolve(packageRoot, native ? 'dist/pilot/cli.js' : 'dist/cli/index.js');
if (!existsSync(cli)) {
  process.stderr.write(`Council build is missing at ${cli}. Run npm run build in ${packageRoot} after explicitly preparing project-local dependencies.\n`);
  process.exitCode = 4;
} else {
  // The CLI owns validation, policy, control schemas, output and exit codes.
  // No shell, installation, inferred input, auto-resume or configuration rewrite.
  const child = spawn(process.execPath, [cli, ...process.argv.slice(native ? 3 : 2)], { stdio: 'inherit', shell: false });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const handlers = signals.map(signal => {
    const forward = () => child.kill(signal);
    process.on(signal, forward);
    return [signal, forward];
  });
  child.once('error', error => {
    process.stderr.write(`Council CLI could not start: ${error.message}\n`);
    process.exitCode = 4;
  });
  child.once('close', (code, signal) => {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    process.exitCode = code ?? ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal] ?? 3);
  });
}
