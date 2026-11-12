import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseClient } from '../../src/server/storage/client.js';

let folder: string, path: string, db: DatabaseClient;
const time = Date.UTC(2026, 10, 11, 12);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function owner(name = 'owner') {
  return (await db.call('createSession', digest(name), time, time + 10000)).ownerId;
}
const input = (text = 'Original question') => ({
  requestId: randomUUID(),
  text,
  timezone: 'Asia/Kolkata',
});
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'thread-store-'));
  path = join(folder, 'test.sqlite');
  db = await openDatabase(path, { now: time });
});
afterEach(async () => {
  await db.close();
  await rm(folder, { recursive: true, force: true });
});

describe('durable conversation store', () => {
  it('replaces an edited question and removes dependent turns, sources, and search history', async () => {
    const a = await owner('editor'),
      b = await owner('other-editor');
    const c = await db.call('createConversation', a, 'New conversation', time);
    const first = await db.call('beginTurn', a, c.id, input('Original topic'), time);
    await db.call('startTurn', a, c.id, first.id, time);
    await db.call('completeTurn', a, c.id, first.id, 'Original answer', time + 1);
    const second = await db.call('beginTurn', a, c.id, input('Old follow-up'), time + 2);
    await db.call('startTurn', a, c.id, second.id, time + 2);
    await db.call('completeTurn', a, c.id, second.id, 'Follow-up answer', time + 3);
    await expect(
      db.call('editMessage', b, c.id, first.userMessageId, input('New topic'), time + 4),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const replacement = await db.call(
      'editMessage',
      a,
      c.id,
      first.userMessageId,
      input('New topic'),
      time + 4,
    );
    expect(replacement.state).toBe('pending');
    expect((await db.call('messages', a, c.id, 0, 100)).items.map((item) => item.text)).toEqual([
      'New topic',
    ]);
    expect(await db.call('searchMemory', a, 'Original')).toEqual([]);
    expect((await db.call('conversation', a, c.id)).title).toBe('New topic');
    await expect(db.call('turn', a, c.id, first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(db.call('turn', a, c.id, second.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      db.call('editMessage', a, c.id, replacement.userMessageId, input('Again'), time + 5),
    ).rejects.toMatchObject({ code: 'CONVERSATION_BUSY' });
  });
  it('upgrades a version 3 database with the embedding table', async () => {
    await db.close();
    const previous = new Database(path);
    try {
      previous.exec('DROP TABLE message_embeddings');
      previous.pragma('user_version = 3');
    } finally {
      previous.close();
    }
    db = await openDatabase(path, { now: time });
    expect(await db.call('pendingEmbeddingTexts', await owner('migrated'), 'model', 1)).toEqual([]);
    await db.close();
    const inspect = new Database(path, { readonly: true });
    try {
      expect(inspect.pragma('user_version', { simple: true })).toBe(4);
      expect(
        inspect.prepare("SELECT name FROM sqlite_master WHERE name='message_embeddings'").get(),
      ).toEqual({ name: 'message_embeddings' });
    } finally {
      inspect.close();
    }
    db = await openDatabase(path, { now: time });
  });
  it('titles after a meaningful question and searches messages only within the owner and chosen chat', async () => {
    const a = await owner(),
      b = await owner('search-other');
    const first = await db.call('createConversation', a, 'New conversation', time);
    await db.call('beginTurn', a, first.id, input('hi'), time);
    expect((await db.call('conversation', a, first.id)).title).toBe('New conversation');
    // A greeting turn may be pending; cancel it before the next user message.
    const greeting = await db.call('latestTurn', a, first.id);
    await db.call('stopTurn', a, first.id, greeting!.id, 'cancelled', time);
    await db.call(
      'beginTurn',
      a,
      first.id,
      input('What is the gold price in India today?'),
      time + 1,
    );
    expect((await db.call('conversation', a, first.id)).title).toBe('Gold price in India today');
    const second = await db.call('createConversation', a, 'Silver prices', time + 2);
    await db.call('beginTurn', a, second.id, input('Compare silver and gold'), time + 2);
    const foreign = await db.call('createConversation', b, 'Private gold', time + 3);
    await db.call('beginTurn', b, foreign.id, input('Private gold plans'), time + 3);
    const all = await db.call('searchMessages', a, 'gold', null);
    expect(all.messages.map((row) => row.conversationId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(all.conversations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.id })]),
    );
    expect((await db.call('searchMessages', a, 'gold', first.id)).messages).toHaveLength(1);
    await expect(db.call('searchMessages', b, 'gold', first.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('retrieves dated and lexical memory only for its owner', async () => {
    const a = await owner(),
      b = await owner('other');
    const c = await db.call('createConversation', a, 'New conversation', time);
    await db.call('beginTurn', a, c.id, input('Shortlisted Acme CRM and Beta CRM'), time);
    expect((await db.call('datedMemory', a, time - 1, time + 1)).map((item) => item.text)).toEqual([
      'Shortlisted Acme CRM and Beta CRM',
    ]);
    expect((await db.call('searchMemory', a, 'Acme CRM')).map((item) => item.text)).toEqual([
      'Shortlisted Acme CRM and Beta CRM',
    ]);
    expect(await db.call('searchMemory', b, 'Acme CRM')).toEqual([]);
    expect((await db.call('conversation', a, c.id)).title).toBe(
      'Shortlisted Acme CRM and Beta CRM',
    );
    await db.call('deleteConversation', a, c.id);
    expect(await db.call('searchMemory', a, 'Acme CRM')).toEqual([]);
  });
  it('persists owner-scoped semantic vectors and deletes them with conversations', async () => {
    const a = await owner('vectors-a');
    const b = await owner('vectors-b');
    const conversation = await db.call('createConversation', a, 'Old work', time);
    const foreign = await db.call('createConversation', b, 'Private work', time);
    const first = await db.call('beginTurn', a, conversation.id, input('Hosting decision'), time);
    const other = await db.call('beginTurn', b, foreign.id, input('Private topic'), time);
    const vector = [1, ...Array<number>(767).fill(0)];
    expect(await db.call('pendingEmbeddingTexts', a, 'gemini-embedding-001', 40)).toMatchObject([
      { id: first.userMessageId },
    ]);
    await db.call('saveEmbeddings', a, 'gemini-embedding-001', [
      { id: first.userMessageId, vector },
    ]);
    await db.call('saveEmbeddings', b, 'gemini-embedding-001', [
      { id: other.userMessageId, vector },
    ]);
    expect(await db.call('pendingEmbeddingTexts', a, 'gemini-embedding-001', 40)).toEqual([]);
    expect(
      (await db.call('semanticMemory', a, 'gemini-embedding-001', vector, 8, 'none')).map(
        (row) => row.id,
      ),
    ).toEqual([first.userMessageId]);
    await expect(
      db.call('saveEmbeddings', a, 'gemini-embedding-001', [{ id: other.userMessageId, vector }]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.close();
    db = await openDatabase(path, { now: time + 1 });
    expect(
      await db.call('semanticMemory', a, 'gemini-embedding-001', vector, 8, 'none'),
    ).toHaveLength(1);
    await db.call('deleteConversation', a, conversation.id);
    expect(await db.call('semanticMemory', a, 'gemini-embedding-001', vector, 8, 'none')).toEqual(
      [],
    );
    expect(
      await db.call('semanticMemory', b, 'gemini-embedding-001', vector, 8, 'none'),
    ).toHaveLength(1);
  });
  it('commits an answer and its cited source snapshot together', async () => {
    const a = await owner(),
      b = await owner('other'),
      c = await db.call('createConversation', a, 'Evidence', time);
    const turn = await db.call('beginTurn', a, c.id, input('What changed?'), time);
    await db.call('startTurn', a, c.id, turn.id, time);
    await db.call('completeTurn', a, c.id, turn.id, 'The price is listed [S1].', time, [
      {
        id: 'S1',
        title: 'Price page',
        url: 'https://example.com/pricing',
        excerpt: 'Plan $10',
        published: undefined,
        observedAt: '2026-11-11T12:00:00Z',
      },
    ]);
    expect(await db.call('turnSources', a, c.id, turn.id)).toEqual([
      {
        id: 'S1',
        title: 'Price page',
        url: 'https://example.com/pricing',
        excerpt: 'Plan $10',
        published: null,
        observedAt: '2026-11-11T12:00:00Z',
      },
    ]);
    expect(
      await db.call('historicalSources', a, [
        (await db.call('turn', a, c.id, turn.id)).assistantMessageId!,
      ]),
    ).toMatchObject([{ sourceId: 'S1', url: 'https://example.com/pricing' }]);
    expect(
      await db.call('historicalSources', b, [
        (await db.call('turn', a, c.id, turn.id)).assistantMessageId!,
      ]),
    ).toEqual([]);
    await expect(db.call('turnSources', b, c.id, turn.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('persists session ownership and conversations across restart, rejects expiry and revocation', async () => {
    const a = await owner();
    const conversation = await db.call('createConversation', a, 'My first question', time);
    await db.close();
    db = await openDatabase(path, { now: time + 1 });
    expect((await db.call('session', digest('owner'), time + 1)).ownerId).toBe(a);
    expect((await db.call('conversations', a, Number.MAX_SAFE_INTEGER, 10)).items[0]).toEqual(
      conversation,
    );
    await expect(db.call('session', digest('owner'), time + 10000)).rejects.toMatchObject({
      code: 'SESSION_REQUIRED',
    });
    await db.call('revokeSession', digest('owner'));
    await expect(db.call('session', digest('owner'), time + 1)).rejects.toMatchObject({
      code: 'SESSION_REQUIRED',
    });
  });
  it('isolates reads, writes, cancellation, retry and deletion across owners', async () => {
    const a = await owner(),
      b = await owner('b');
    const c = await db.call('createConversation', a, 'Private', time);
    const t = await db.call('beginTurn', a, c.id, input(), time);
    expect((await db.call('conversations', b, Number.MAX_SAFE_INTEGER, 10)).items).toEqual([]);
    for (const action of [
      () => db.call('conversation', b, c.id),
      () => db.call('messages', b, c.id, 0, 10),
      () => db.call('beginTurn', b, c.id, input(), time),
      () => db.call('turn', b, c.id, t.id),
      () => db.call('startTurn', b, c.id, t.id, time),
      () => db.call('completeTurn', b, c.id, t.id, 'stolen', time),
      () => db.call('stopTurn', b, c.id, t.id, 'cancelled', time),
      () => db.call('retryTurn', b, c.id, t.id, randomUUID(), time),
      () => db.call('deleteConversation', b, c.id),
    ])
      await expect(action()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await db.call('turn', a, c.id, t.id)).state).toBe('pending');
  });
  it('deduplicates concurrent identical submissions and rejects changed request content', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Idempotency', time),
      question = input();
    const turns = await Promise.all(
      Array.from({ length: 10 }, () => db.call('beginTurn', a, c.id, question, time)),
    );
    expect(new Set(turns.map((t) => t.id)).size).toBe(1);
    expect((await db.call('messages', a, c.id, 0, 100)).items).toHaveLength(1);
    await expect(
      db.call('beginTurn', a, c.id, { ...question, text: 'Changed' }, time),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      db.call('beginTurn', a, c.id, { ...question, timezone: 'UTC' }, time),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(db.call('beginTurn', a, c.id, input('Another'), time)).rejects.toMatchObject({
      code: 'CONVERSATION_BUSY',
    });
  });
  it('admits only one of two simultaneous distinct turns without orphan messages', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Race', time);
    const results = await Promise.allSettled([
      db.call('beginTurn', a, c.id, input('First'), time),
      db.call('beginTurn', a, c.id, input('Second'), time),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await db.call('messages', a, c.id, 0, 100)).items).toHaveLength(1);
  });
  it('commits an answer with its turn atomically, preserves original text and avoids duplicate completion', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Atomic', time);
    const t = await db.call('beginTurn', a, c.id, input('  Exact original  '), time);
    await expect(db.call('completeTurn', a, c.id, t.id, 'Answer', time + 1)).rejects.toMatchObject({
      code: 'INVALID_TURN_STATE',
    });
    await db.call('startTurn', a, c.id, t.id, time + 1);
    const done = await db.call('completeTurn', a, c.id, t.id, 'Answer', time + 2);
    expect(await db.call('completeTurn', a, c.id, t.id, 'Answer', time + 3)).toEqual(done);
    await expect(
      db.call('completeTurn', a, c.id, t.id, 'Different', time + 3),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const messages = (await db.call('messages', a, c.id, 0, 100)).items;
    expect(messages.map((m) => m.text)).toEqual(['  Exact original  ', 'Answer']);
    expect(messages[0]).toMatchObject({ createdAt: time, timezone: 'Asia/Kolkata' });
    expect(messages[1]!.id).toBe(done.assistantMessageId);
    await db.close();
    const inspect = new Database(path);
    try {
      expect(() =>
        inspect.prepare('UPDATE messages SET text=? WHERE id=?').run('Changed', messages[0]!.id),
      ).toThrow('Immutable message');
      expect(inspect.prepare('SELECT text FROM messages WHERE id=?').get(messages[0]!.id)).toEqual({
        text: '  Exact original  ',
      });
    } finally {
      inspect.close();
    }
  });
  it('recovers pending and running turns after a worker crash; retries keep the original message', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Recovery', time),
      c2 = await db.call('createConversation', a, 'Pending', time);
    const question = input(),
      t = await db.call('beginTurn', a, c.id, question, time);
    const pending = await db.call('beginTurn', a, c2.id, input(), time);
    await db.call('startTurn', a, c.id, t.id, time + 1);
    await db.forceClose();
    db = await openDatabase(path, { now: time + 5 });
    expect((await db.call('turn', a, c.id, t.id)).state).toBe('interrupted');
    expect((await db.call('turn', a, c2.id, pending.id)).state).toBe('interrupted');
    expect((await db.call('beginTurn', a, c.id, question, time + 6)).id).toBe(t.id);
    const requestId = randomUUID();
    const retry = await db.call('retryTurn', a, c.id, t.id, requestId, time + 6);
    expect(retry).toMatchObject({
      retryOf: t.id,
      userMessageId: t.userMessageId,
      state: 'pending',
    });
    expect((await db.call('retryTurn', a, c.id, t.id, requestId, time + 7)).id).toBe(retry.id);
    expect((await db.call('messages', a, c.id, 0, 100)).items).toHaveLength(1);
  });
  it('blocks late completion after cancellation and after deletion', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Late work', time);
    const t = await db.call('beginTurn', a, c.id, input(), time);
    await db.call('startTurn', a, c.id, t.id, time);
    await db.call('stopTurn', a, c.id, t.id, 'cancelled', time);
    await expect(db.call('completeTurn', a, c.id, t.id, 'Late', time)).rejects.toMatchObject({
      code: 'INVALID_TURN_STATE',
    });
    await db.call('deleteConversation', a, c.id);
    await expect(db.call('completeTurn', a, c.id, t.id, 'Late', time)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('cascades completed and retried turns without deleting another owner history', async () => {
    const a = await owner(),
      b = await owner('b'),
      c = await db.call('createConversation', a, 'Delete', time);
    const other = await db.call('createConversation', b, 'Keep', time);
    const t = await db.call('beginTurn', a, c.id, input(), time);
    await db.call('stopTurn', a, c.id, t.id, 'failed', time);
    const retry = await db.call('retryTurn', a, c.id, t.id, randomUUID(), time);
    await db.call('startTurn', a, c.id, retry.id, time);
    await db.call('completeTurn', a, c.id, retry.id, 'Done', time);
    await db.call('deleteHistory', a);
    expect((await db.call('conversation', b, other.id)).title).toBe('Keep');
    await db.close();
    const inspect = new Database(path);
    try {
      expect(inspect.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
      expect(inspect.prepare('SELECT COUNT(*) AS n FROM turns').get()).toEqual({ n: 0 });
      expect(inspect.pragma('foreign_key_check')).toEqual([]);
    } finally {
      inspect.close();
    }
  });
  it('uses bounded keyset pages even when a previous conversation is deleted', async () => {
    const a = await owner();
    const first = await db.call('createConversation', a, 'First', time),
      second = await db.call('createConversation', a, 'Second', time);
    const page = await db.call('conversations', a, Number.MAX_SAFE_INTEGER, 1);
    expect(page.items[0]!.id).toBe(second.id);
    expect(page.hasMore).toBe(true);
    await db.call('deleteConversation', a, second.id);
    expect((await db.call('conversations', a, second.sequence, 1)).items[0]!.id).toBe(first.id);
  });
  it('rejects a second application without interrupting the first application active turn', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Exclusive', time);
    const t = await db.call('beginTurn', a, c.id, input(), time);
    await expect(openDatabase(path)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect((await db.call('turn', a, c.id, t.id)).state).toBe('pending');
  });
  it('rolls back failed answer insertion and leaves the original question intact', async () => {
    const a = await owner(),
      c = await db.call('createConversation', a, 'Rollback', time);
    await db.close();
    const inspect = new Database(path);
    inspect.exec(
      "CREATE TRIGGER fail_answer AFTER INSERT ON messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
    inspect.close();
    db = await openDatabase(path, { now: time });
    const t = await db.call('beginTurn', a, c.id, input(), time);
    await db.call('startTurn', a, c.id, t.id, time);
    await expect(db.call('completeTurn', a, c.id, t.id, 'Answer', time)).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
    });
    expect((await db.call('turn', a, c.id, t.id)).state).toBe('running');
    expect((await db.call('messages', a, c.id, 0, 100)).items.map((m) => m.role)).toEqual(['user']);
  });
  it('bounds outstanding work and rejects work after worker termination', async () => {
    await db.close();
    db = await openDatabase(path, { maxPending: 1 });
    const first = db.call('createSession', digest('one'), time, time + 1000);
    await expect(db.call('createSession', digest('two'), time, time + 1000)).rejects.toMatchObject({
      code: 'DATABASE_BUSY',
    });
    await first;
    const pending = db.call('session', digest('one'), time);
    const result = expect(pending).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    await db.forceClose();
    await result;
    expect(db.available).toBe(false);
    await expect(db.call('session', digest('one'), time)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
  });
  it('refuses a newer schema without changing its version', async () => {
    await db.close();
    const inspect = new Database(path);
    inspect.pragma('user_version = 999');
    inspect.close();
    await expect(openDatabase(path)).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    const unchanged = new Database(path);
    try {
      expect(unchanged.pragma('user_version', { simple: true })).toBe(999);
    } finally {
      unchanged.close();
    }
  });
});
