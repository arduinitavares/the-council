CREATE TABLE checkpoints (
  run_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  snapshot TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL
);
CREATE TABLE journal (
  run_id TEXT NOT NULL REFERENCES checkpoints(run_id),
  event_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  event_hash TEXT NOT NULL,
  event TEXT NOT NULL,
  intents TEXT NOT NULL,
  restoration TEXT NOT NULL CHECK (restoration IN ('none', 'reconcile')),
  input_checkpoint_hash TEXT NOT NULL,
  checkpoint_hash TEXT NOT NULL,
  PRIMARY KEY (run_id, event_id),
  UNIQUE (run_id, revision)
);
CREATE TABLE outbox (
  key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES checkpoints(run_id),
  created_revision INTEGER NOT NULL,
  intent TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_execution', 'dispatched', 'receipt_recorded', 'superseded')),
  receipt TEXT,
  receipt_event_id TEXT,
  FOREIGN KEY (run_id, receipt_event_id) REFERENCES journal(run_id, event_id),
  CHECK ((receipt IS NULL) = (receipt_event_id IS NULL)),
  CHECK ((status = 'receipt_recorded') = (receipt IS NOT NULL))
);
CREATE INDEX outbox_pending ON outbox(run_id, status, created_revision);
CREATE TABLE writer_leases (
  run_id TEXT PRIMARY KEY REFERENCES checkpoints(run_id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  owner_id TEXT NOT NULL,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL CHECK (pid > 0),
  process_start TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1))
);
CREATE TABLE writer_history (
  run_id TEXT NOT NULL REFERENCES checkpoints(run_id),
  generation INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  process_start TEXT NOT NULL,
  acquisition TEXT NOT NULL,
  PRIMARY KEY (run_id, generation)
);
PRAGMA user_version = 1;
