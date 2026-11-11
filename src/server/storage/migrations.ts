import type Database from 'better-sqlite3';

export function migrate(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 3) throw new Error('Unsupported database version');
  if (version === 0)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE owners (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL) STRICT;
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
      ) STRICT;
      CREATE INDEX sessions_owner ON sessions(owner_id);
      CREATE TABLE conversations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX conversations_owner ON conversations(owner_id, sequence DESC);
      CREATE TABLE messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        text TEXT NOT NULL CHECK(length(text) > 0), created_at INTEGER NOT NULL, timezone TEXT NOT NULL
      ) STRICT;
      CREATE INDEX messages_conversation ON messages(conversation_id, sequence);
      CREATE TRIGGER messages_immutable BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'Immutable message'); END;
      CREATE TABLE turns (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        assistant_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        retry_of TEXT REFERENCES turns(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed','cancelled','interrupted')),
        failure_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(conversation_id, request_id),
        CHECK ((state = 'completed') = (assistant_message_id IS NOT NULL))
      ) STRICT;
      CREATE UNIQUE INDEX one_active_turn ON turns(conversation_id) WHERE state IN ('pending','running');
      CREATE INDEX turns_conversation ON turns(conversation_id);
      PRAGMA user_version = 1;
    `);
    }).immediate();
  if (version < 2)
    db.transaction(() => {
      db.exec(`
      CREATE VIRTUAL TABLE message_search USING fts5(text, content='messages', content_rowid='sequence', tokenize='unicode61');
      INSERT INTO message_search(message_search) VALUES('rebuild');
      CREATE TRIGGER message_search_insert AFTER INSERT ON messages BEGIN
        INSERT INTO message_search(rowid,text) VALUES(new.sequence,new.text);
      END;
      CREATE TRIGGER message_search_delete AFTER DELETE ON messages BEGIN
        INSERT INTO message_search(message_search,rowid,text) VALUES('delete',old.sequence,old.text);
      END;
      CREATE INDEX messages_created ON messages(created_at,conversation_id);
      PRAGMA user_version = 2;
    `);
    }).immediate();
  if (version < 3)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE turn_sources (
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
          excerpt TEXT NOT NULL, published_at TEXT, observed_at TEXT NOT NULL,
          PRIMARY KEY(turn_id,source_id)
        ) STRICT;
        PRAGMA user_version = 3;
      `);
    }).immediate();
}
