import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from './migrations.ts';
import { StoreError } from './errors.ts';
import { submitMessageSchema } from '../../shared/contracts.ts';

export type Session = { ownerId: string; expiresAt: number };
export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sequence: number;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  timezone: string;
  sequence: number;
};
export type Turn = {
  id: string;
  conversationId: string;
  requestId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  retryOf: string | null;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  failureCode: string | null;
  createdAt: number;
  updatedAt: number;
};
type TurnRow = Turn & { requestHash: string };
const turnColumns = `id, conversation_id AS conversationId, request_id AS requestId,
 user_message_id AS userMessageId, assistant_message_id AS assistantMessageId, retry_of AS retryOf,
 state, failure_code AS failureCode, created_at AS createdAt, updated_at AS updatedAt`;
const conversationColumns = 'id, title, created_at AS createdAt, updated_at AS updatedAt, sequence';
const messageColumns = 'id, role, text, created_at AS createdAt, timezone, sequence';
const hash = (text: string, timezone: string, retryOf: string | null) =>
  createHash('sha256')
    .update(JSON.stringify([text, timezone, retryOf]))
    .digest('hex');
function validatePage(cursor: number, limit: number) {
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new StoreError('INVALID_INPUT');
}

export function createStore(path: string, now = Date.now()) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path, { timeout: 1500 });
  try {
    db.pragma('foreign_keys = ON');
    // One application process owns this local database, including crash recovery.
    db.pragma('locking_mode = EXCLUSIVE');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    migrate(db);
    db.prepare(
      "UPDATE turns SET state='interrupted', failure_code='PROCESS_INTERRUPTED', updated_at=? WHERE state IN ('pending','running')",
    ).run(now);
  } catch (error) {
    db.close();
    throw error;
  }

  const owned = (ownerId: string, conversationId: string): Conversation => {
    const row = db
      .prepare(`SELECT ${conversationColumns} FROM conversations WHERE id=? AND owner_id=?`)
      .get(conversationId, ownerId) as Conversation | undefined;
    if (!row) throw new StoreError('NOT_FOUND');
    return row;
  };
  const turn = (ownerId: string, conversationId: string, turnId: string): Turn => {
    owned(ownerId, conversationId);
    const row = db
      .prepare(`SELECT ${turnColumns} FROM turns WHERE id=? AND conversation_id=?`)
      .get(turnId, conversationId) as Turn | undefined;
    if (!row) throw new StoreError('NOT_FOUND');
    return row;
  };
  const addMessage = (
    conversationId: string,
    role: Message['role'],
    text: string,
    timezone: string,
    at: number,
  ) => {
    const id = randomUUID();
    db.prepare(
      'INSERT INTO messages(id,conversation_id,role,text,timezone,created_at) VALUES(?,?,?,?,?,?)',
    ).run(id, conversationId, role, text, timezone, at);
    return id;
  };
  const insertTurn = (
    ownerId: string,
    conversationId: string,
    input: { requestId: string; text: string; timezone: string },
    at: number,
    retryOf: string | null = null,
    existingMessage?: string,
  ): Turn => {
    owned(ownerId, conversationId);
    const valid = submitMessageSchema.parse(input);
    const requestHash = hash(valid.text, valid.timezone, retryOf);
    const prior = db
      .prepare(
        `SELECT ${turnColumns},request_hash AS requestHash FROM turns WHERE conversation_id=? AND request_id=?`,
      )
      .get(conversationId, valid.requestId) as TurnRow | undefined;
    if (prior) {
      if (prior.requestHash !== requestHash) throw new StoreError('IDEMPOTENCY_CONFLICT');
      return turn(ownerId, conversationId, prior.id);
    }
    if (
      db
        .prepare("SELECT 1 FROM turns WHERE conversation_id=? AND state IN ('pending','running')")
        .get(conversationId)
    )
      throw new StoreError('CONVERSATION_BUSY');
    const id = randomUUID();
    const messageId =
      existingMessage ?? addMessage(conversationId, 'user', valid.text, valid.timezone, at);
    db.prepare(
      "INSERT INTO turns(id,conversation_id,request_id,request_hash,user_message_id,retry_of,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)",
    ).run(id, conversationId, valid.requestId, requestHash, messageId, retryOf, at, at);
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(at, conversationId);
    return turn(ownerId, conversationId, id);
  };
  const operations = {
    createSession(tokenHash: string, at: number, expiresAt: number): Session {
      return db
        .transaction(() => {
          const ownerId = randomUUID();
          db.prepare('INSERT INTO owners VALUES(?,?)').run(ownerId, at);
          db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash, ownerId, at, expiresAt);
          return { ownerId, expiresAt };
        })
        .immediate();
    },
    session(tokenHash: string, at: number): Session {
      const row = db
        .prepare(
          'SELECT owner_id AS ownerId, expires_at AS expiresAt FROM sessions WHERE token_hash=? AND expires_at>?',
        )
        .get(tokenHash, at) as Session | undefined;
      if (!row) throw new StoreError('SESSION_REQUIRED');
      return row;
    },
    revokeSession(tokenHash: string) {
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    },
    createConversation(ownerId: string, title: string, at: number): Conversation {
      if (!title.trim() || title.length > 200) throw new StoreError('INVALID_INPUT');
      const id = randomUUID();
      db.prepare(
        'INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
      ).run(id, ownerId, title.trim(), at, at);
      return owned(ownerId, id);
    },
    conversations(ownerId: string, before: number, limit: number) {
      validatePage(before, limit);
      const rows = db
        .prepare(
          `SELECT ${conversationColumns} FROM conversations WHERE owner_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?`,
        )
        .all(ownerId, before, limit + 1) as Conversation[];
      return { items: rows.slice(0, limit), hasMore: rows.length > limit };
    },
    conversation: owned,
    messages(ownerId: string, conversationId: string, after: number, limit: number) {
      validatePage(after, limit);
      owned(ownerId, conversationId);
      const rows = db
        .prepare(
          `SELECT ${messageColumns} FROM messages WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?`,
        )
        .all(conversationId, after, limit + 1) as Message[];
      return { items: rows.slice(0, limit), hasMore: rows.length > limit };
    },
    deleteConversation(ownerId: string, conversationId: string) {
      owned(ownerId, conversationId);
      db.prepare('DELETE FROM conversations WHERE id=? AND owner_id=?').run(
        conversationId,
        ownerId,
      );
    },
    deleteHistory(ownerId: string) {
      db.prepare('DELETE FROM conversations WHERE owner_id=?').run(ownerId);
    },
    beginTurn(
      ownerId: string,
      conversationId: string,
      input: { requestId: string; text: string; timezone: string },
      at: number,
    ) {
      return db.transaction(() => insertTurn(ownerId, conversationId, input, at)).immediate();
    },
    turn,
    startTurn(ownerId: string, conversationId: string, turnId: string, at: number) {
      const row = turn(ownerId, conversationId, turnId);
      if (row.state !== 'pending') throw new StoreError('INVALID_TURN_STATE');
      db.prepare("UPDATE turns SET state='running',updated_at=? WHERE id=?").run(at, turnId);
      return turn(ownerId, conversationId, turnId);
    },
    completeTurn(
      ownerId: string,
      conversationId: string,
      turnId: string,
      text: string,
      at: number,
    ): Turn {
      if (!text.trim() || text.length > 64000) throw new StoreError('INVALID_INPUT');
      return db
        .transaction(() => {
          const row = turn(ownerId, conversationId, turnId);
          if (row.state === 'completed') {
            const previous = db
              .prepare('SELECT text FROM messages WHERE id=?')
              .get(row.assistantMessageId) as { text: string };
            if (previous.text !== text) throw new StoreError('IDEMPOTENCY_CONFLICT');
            return row;
          }
          if (row.state !== 'running') throw new StoreError('INVALID_TURN_STATE');
          const original = db
            .prepare('SELECT timezone FROM messages WHERE id=?')
            .get(row.userMessageId) as { timezone: string };
          const messageId = addMessage(conversationId, 'assistant', text, original.timezone, at);
          db.prepare(
            "UPDATE turns SET state='completed',assistant_message_id=?,updated_at=? WHERE id=?",
          ).run(messageId, at, turnId);
          db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(at, conversationId);
          return turn(ownerId, conversationId, turnId);
        })
        .immediate();
    },
    stopTurn(
      ownerId: string,
      conversationId: string,
      turnId: string,
      state: 'failed' | 'cancelled',
      at: number,
    ) {
      const row = turn(ownerId, conversationId, turnId);
      if (row.state === state) return row;
      if (!['pending', 'running'].includes(row.state)) throw new StoreError('INVALID_TURN_STATE');
      db.prepare('UPDATE turns SET state=?,failure_code=?,updated_at=? WHERE id=?').run(
        state,
        state === 'failed' ? 'EXECUTION_FAILED' : null,
        at,
        turnId,
      );
      return turn(ownerId, conversationId, turnId);
    },
    retryTurn(
      ownerId: string,
      conversationId: string,
      turnId: string,
      requestId: string,
      at: number,
    ) {
      return db
        .transaction(() => {
          const original = turn(ownerId, conversationId, turnId);
          if (!['failed', 'cancelled', 'interrupted'].includes(original.state))
            throw new StoreError('INVALID_TURN_STATE');
          const message = db
            .prepare('SELECT text,timezone FROM messages WHERE id=?')
            .get(original.userMessageId) as { text: string; timezone: string };
          return insertTurn(
            ownerId,
            conversationId,
            { requestId, ...message },
            at,
            turnId,
            original.userMessageId,
          );
        })
        .immediate();
    },
  };
  return { operations, close: () => db.close() };
}
export type StoreOperations = ReturnType<typeof createStore>['operations'];
