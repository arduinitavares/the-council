import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
// Remove only stale generated relay artifacts from earlier builds. Its source
// remains available for development; native caller authority is unqualified.
for (const name of ['host-relay.js', 'host-relay.d.ts']) {
  rmSync(new URL(`../dist/pilot/${name}`, import.meta.url), { force: true });
}
const destination = new URL('../dist/store/', import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(new URL('../src/store/schema.sql', import.meta.url), new URL('schema.sql', destination));
