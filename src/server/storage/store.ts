import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from './migrations.ts';
import { StoreError } from './errors.ts';
import { submitMessageSchema } from '../../shared/contracts.ts';
import { isPlaceholderTitle, suggestedTitle } from '../conversations/title.ts';

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
  sources?: Array<{
    id: string;
    title: string;
    url: string;
    excerpt: string;
    published: string | null;
    observedAt: string;
  }>;
};
type IndexedMemory = {
  id: string;
  role: string;
  text: string;
  createdAt: number;
  timezone: string;
  conversationTitle: string;
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
    if (!existingMessage) {
      const conversation = owned(ownerId, conversationId);
      const title = suggestedTitle(valid.text);
      if (title && isPlaceholderTitle(conversation.title))
        db.prepare('UPDATE conversations SET title=? WHERE id=?').run(title, conversationId);
    }
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
      const items = rows.slice(0, limit);
      const assistantIds = items.filter((row) => row.role === 'assistant').map((row) => row.id);
      if (assistantIds.length) {
        const sources = db
          .prepare(
            `SELECT t.assistant_message_id AS messageId, s.source_id AS id, s.title, s.url,
              s.excerpt, s.published_at AS published, s.observed_at AS observedAt
             FROM turn_sources s JOIN turns t ON t.id=s.turn_id
             WHERE t.conversation_id=? AND t.assistant_message_id IN (${assistantIds.map(() => '?').join(',')})
             ORDER BY s.rowid`,
          )
          .all(conversationId, ...assistantIds) as Array<
          NonNullable<Message['sources']>[number] & { messageId: string }
        >;
        const byMessage = new Map(items.map((row) => [row.id, row]));
        for (const source of sources) {
          const message = byMessage.get(source.messageId);
          if (message)
            (message.sources ??= []).push({
              id: source.id,
              title: source.title,
              url: source.url,
              excerpt: source.excerpt,
              published: source.published,
              observedAt: source.observedAt,
            });
        }
      }
      return { items, hasMore: rows.length > limit };
    },
    recentThread(ownerId: string, conversationId: string, limit: number) {
      owned(ownerId, conversationId);
      const rows = db
        .prepare(
          `SELECT ${messageColumns} FROM messages WHERE conversation_id=? ORDER BY sequence DESC LIMIT ?`,
        )
        .all(conversationId, Math.min(limit, 40)) as Message[];
      return rows.reverse();
    },
    recentMemory(ownerId: string, limit: number) {
      return db
        .prepare(
          `SELECT m.id,m.role,m.text,m.created_at AS createdAt,m.timezone,
        c.title AS conversationTitle FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.owner_id=? ORDER BY m.sequence DESC LIMIT ?`,
        )
        .all(ownerId, Math.min(limit, 80)) as Array<{
        id: string;
        role: string;
        text: string;
        createdAt: number;
        timezone: string;
        conversationTitle: string;
      }>;
    },
    pendingEmbeddingTexts(ownerId: string, model: string, limit: number) {
      if (!model || !Number.isInteger(limit) || limit < 1 || limit > 60)
        throw new StoreError('INVALID_INPUT');
      return db
        .prepare(
          `SELECT m.id,m.text FROM messages m JOIN conversations c ON c.id=m.conversation_id
           LEFT JOIN message_embeddings e ON e.message_id=m.id AND e.model=?
           WHERE c.owner_id=? AND e.message_id IS NULL ORDER BY m.sequence LIMIT ?`,
        )
        .all(model, ownerId, limit) as Array<{ id: string; text: string }>;
    },
    saveEmbeddings(ownerId: string, model: string, items: Array<{ id: string; vector: number[] }>) {
      if (!model || items.length > 60) throw new StoreError('INVALID_INPUT');
      return db
        .transaction(() => {
          const ownedMessage = db.prepare(
            `SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id
             WHERE m.id=? AND c.owner_id=?`,
          );
          const insert = db.prepare(
            'INSERT OR REPLACE INTO message_embeddings(message_id,model,vector) VALUES(?,?,?)',
          );
          for (const item of items) {
            if (!ownedMessage.get(item.id, ownerId)) throw new StoreError('NOT_FOUND');
            if (item.vector.length !== 768 || item.vector.some((value) => !Number.isFinite(value)))
              throw new StoreError('INVALID_INPUT');
            const vector = Buffer.allocUnsafe(768 * 4);
            item.vector.forEach((value, index) => vector.writeFloatLE(value, index * 4));
            insert.run(item.id, model, vector);
          }
          return items.length;
        })
        .immediate();
    },
    semanticMemory(
      ownerId: string,
      model: string,
      vector: number[],
      limit: number,
      excludeMessageId: string,
    ) {
      if (
        !model ||
        vector.length !== 768 ||
        vector.some((value) => !Number.isFinite(value)) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 20
      )
        throw new StoreError('INVALID_INPUT');
      const rows = db
        .prepare(
          `SELECT m.id,m.role,m.text,m.created_at AS createdAt,m.timezone,
           c.title AS conversationTitle,e.vector FROM message_embeddings e
           JOIN messages m ON m.id=e.message_id
           JOIN conversations c ON c.id=m.conversation_id
           WHERE c.owner_id=? AND e.model=? ORDER BY m.sequence DESC LIMIT 5000`,
        )
        .all(ownerId, model) as Array<IndexedMemory & { vector: Buffer }>;
      const queryNorm = Math.hypot(...vector) || 1;
      return rows
        .filter((row) => row.id !== excludeMessageId && row.vector.length === 768 * 4)
        .map((row) => {
          let dot = 0;
          let norm = 0;
          for (let index = 0; index < 768; index++) {
            const value = row.vector.readFloatLE(index * 4);
            dot += vector[index]! * value;
            norm += value * value;
          }
          const { vector: _stored, ...record } = row;
          return { record, score: dot / (queryNorm * Math.sqrt(norm || 1)) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.record);
    },
    datedMemory(ownerId: string, from: number, to: number) {
      return db
        .prepare(
          `SELECT m.id,m.role,m.text,m.created_at AS createdAt,m.timezone,
        c.title AS conversationTitle FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.owner_id=? AND m.created_at>=? AND m.created_at<? ORDER BY m.created_at,m.sequence LIMIT 100`,
        )
        .all(ownerId, from, to) as Array<{
        id: string;
        role: string;
        text: string;
        createdAt: number;
        timezone: string;
        conversationTitle: string;
      }>;
    },
    searchMemory(ownerId: string, query: string) {
      const tokens = query.match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 8) ?? [];
      if (!tokens.length) return [];
      const safe = tokens.map((token) => `"${token.replaceAll('"', '')}"`).join(' OR ');
      return db
        .prepare(
          `SELECT m.id,m.role,m.text,m.created_at AS createdAt,m.timezone,
        c.title AS conversationTitle FROM message_search s JOIN messages m ON m.sequence=s.rowid
        JOIN conversations c ON c.id=m.conversation_id WHERE c.owner_id=? AND message_search MATCH ?
        ORDER BY bm25(message_search) LIMIT 30`,
        )
        .all(ownerId, safe) as Array<{
        id: string;
        role: string;
        text: string;
        createdAt: number;
        timezone: string;
        conversationTitle: string;
      }>;
    },
    searchMessages(ownerId: string, query: string, conversationId: string | null) {
      if (conversationId) owned(ownerId, conversationId);
      const words = query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 8) ?? [];
      if (!words.length) return { conversations: [], messages: [] };
      const titleRows = conversationId
        ? []
        : (db
            .prepare(
              `SELECT id,title,updated_at AS updatedAt FROM conversations
         WHERE owner_id=? AND instr(lower(title),lower(?))>0
         ORDER BY updated_at DESC LIMIT 8`,
            )
            .all(ownerId, query) as Array<{ id: string; title: string; updatedAt: number }>);
      const safe = words.map((word) => `"${word}"`).join(' OR ');
      const messages = db
        .prepare(
          `SELECT m.id AS messageId,c.id AS conversationId,c.title AS conversationTitle,
          m.role,substr(m.text,1,260) AS preview,m.created_at AS createdAt
         FROM message_search s JOIN messages m ON m.sequence=s.rowid
         JOIN conversations c ON c.id=m.conversation_id
         WHERE c.owner_id=? AND message_search MATCH ? ${conversationId ? 'AND c.id=?' : ''}
         ORDER BY bm25(message_search),m.created_at DESC LIMIT 40`,
        )
        .all(ownerId, safe, ...(conversationId ? [conversationId] : [])) as Array<{
        messageId: string;
        conversationId: string;
        conversationTitle: string;
        role: Message['role'];
        preview: string;
        createdAt: number;
      }>;
      return { conversations: titleRows, messages };
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
    editMessage(
      ownerId: string,
      conversationId: string,
      messageId: string,
      input: { requestId: string; text: string; timezone: string },
      at: number,
    ) {
      return db
        .transaction(() => {
          const conversation = owned(ownerId, conversationId);
          const valid = submitMessageSchema.parse(input);
          const target = db
            .prepare(
              "SELECT sequence FROM messages WHERE id=? AND conversation_id=? AND role='user'",
            )
            .get(messageId, conversationId) as { sequence: number } | undefined;
          if (!target) throw new StoreError('NOT_FOUND');
          if (
            db
              .prepare(
                "SELECT 1 FROM turns WHERE conversation_id=? AND state IN ('pending','running')",
              )
              .get(conversationId)
          )
            throw new StoreError('CONVERSATION_BUSY');
          const removedTitles = db
            .prepare(
              "SELECT text FROM messages WHERE conversation_id=? AND sequence>=? AND role='user'",
            )
            .all(conversationId, target.sequence) as Array<{ text: string }>;
          // Replacing a question invalidates every answer and follow-up after it.
          db.prepare('DELETE FROM messages WHERE conversation_id=? AND sequence>=?').run(
            conversationId,
            target.sequence,
          );
          if (removedTitles.some((item) => suggestedTitle(item.text) === conversation.title)) {
            db.prepare('UPDATE conversations SET title=? WHERE id=?').run(
              suggestedTitle(valid.text) ?? 'New conversation',
              conversationId,
            );
          }
          return insertTurn(ownerId, conversationId, valid, at);
        })
        .immediate();
    },
    turn,
    latestTurn(ownerId: string, conversationId: string) {
      owned(ownerId, conversationId);
      return db
        .prepare(
          `SELECT ${turnColumns} FROM turns WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(conversationId) as Turn | undefined;
    },
    turnMessage(ownerId: string, conversationId: string, turnId: string) {
      const row = turn(ownerId, conversationId, turnId);
      return db
        .prepare(`SELECT ${messageColumns} FROM messages WHERE id=?`)
        .get(row.userMessageId) as Message;
    },
    turnSources(ownerId: string, conversationId: string, turnId: string) {
      turn(ownerId, conversationId, turnId);
      return db
        .prepare(
          `SELECT source_id AS id,title,url,excerpt,published_at AS published,observed_at AS observedAt FROM turn_sources WHERE turn_id=? ORDER BY source_id`,
        )
        .all(turnId) as Array<{
        id: string;
        title: string;
        url: string;
        excerpt: string;
        published: string | null;
        observedAt: string;
      }>;
    },
    historicalSources(ownerId: string, messageIds: string[]) {
      if (
        messageIds.length > 40 ||
        messageIds.some((id) => typeof id !== 'string' || id.length > 80)
      )
        throw new StoreError('INVALID_INPUT');
      if (!messageIds.length) return [];
      return db
        .prepare(
          `SELECT t.assistant_message_id AS messageId,s.source_id AS sourceId,s.title,s.url,
          s.excerpt,s.published_at AS published,s.observed_at AS observedAt
         FROM turn_sources s JOIN turns t ON t.id=s.turn_id
         JOIN conversations c ON c.id=t.conversation_id
         WHERE c.owner_id=? AND t.assistant_message_id IN (${messageIds.map(() => '?').join(',')})
         ORDER BY t.created_at DESC,s.rowid LIMIT 60`,
        )
        .all(ownerId, ...messageIds) as Array<{
        messageId: string;
        sourceId: string;
        title: string;
        url: string;
        excerpt: string;
        published: string | null;
        observedAt: string;
      }>;
    },
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
      sources: Array<{
        id: string;
        title: string;
        url: string;
        excerpt: string;
        published: string | null | undefined;
        observedAt: string;
      }> = [],
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
          const insertSource = db.prepare('INSERT INTO turn_sources VALUES(?,?,?,?,?,?,?)');
          for (const source of sources.slice(0, 60))
            insertSource.run(
              turnId,
              source.id,
              source.title,
              source.url,
              source.excerpt,
              source.published ?? null,
              source.observedAt,
            );
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
