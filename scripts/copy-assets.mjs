import { copyFileSync, mkdirSync } from 'node:fs';
const destination = new URL('../dist/store/', import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(new URL('../src/store/schema.sql', import.meta.url), new URL('schema.sql', destination));
