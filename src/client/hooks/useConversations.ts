import { useCallback, useEffect, useRef, useState } from 'react';
import {
  request,
  loadMessages,
  streamTurn,
  type Conversation,
  type ChatMessage,
  type Turn,
} from '../lib/conversations.js';
export type { ChatMessage } from '../lib/conversations.js';
const failed = (turn: Turn | null) =>
  turn && ['failed', 'cancelled', 'interrupted'].includes(turn.state) ? turn.id : null;
export function useConversations(enabled: boolean) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, select] = useState<string | null>(null);
  const selection = useRef<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const [progress, setProgress] = useState('');
  const setSelected = useCallback((id: string | null) => {
    if (selection.current === id) return;
    running.current?.abort();
    running.current = null;
    selection.current = id;
    select(id);
    setMessages([]);
    setPartial('');
    setBusy(false);
    setError(null);
    setFailedTurn(null);
    setLoading(Boolean(id));
  }, []);
  const refresh = useCallback(async () => {
    const page = await request<{ items: Conversation[] }>('/api/conversations?limit=100');
    setConversations(page.items);
    return page.items;
  }, []);
  useEffect(() => {
    let active = true;
    if (enabled)
      void refresh()
        .then((items) => {
          if (active && !selection.current) setSelected(items[0]?.id ?? null);
        })
        .catch(() => {
          if (active) setError('Could not load conversations.');
        });
    return () => {
      active = false;
    };
  }, [enabled, refresh, setSelected]);
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const [items, turn] = await Promise.all([
          loadMessages(selected, controller.signal),
          request<Turn | null>(`/api/conversations/${selected}/latest-turn`, {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted || running.current) return;
        setMessages(items);
        setFailedTurn(failed(turn));
        setLoading(false);
        // Recover a turn still cancelling after navigation, or running in another tab.
        if (turn && ['pending', 'running'].includes(turn.state))
          timer = setTimeout(() => void load(), 1000);
      } catch {
        if (!controller.signal.aborted) {
          setError('Could not load this conversation.');
          setLoading(false);
        }
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected]);
  const create = async () => {
    try {
      const chat = await request<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: 'New conversation' }),
      });
      setConversations((items) => [chat, ...items]);
      setSelected(chat.id);
      return chat.id;
    } catch {
      setError('Could not create a conversation.');
      return null;
    }
  };
  const remove = async (id: string) => {
    try {
      await request(`/api/conversations/${id}`, { method: 'DELETE' });
      setConversations((items) => items.filter((item) => item.id !== id));
      if (selection.current === id) setSelected(null);
    } catch {
      setError('Could not delete this conversation.');
    }
  };
  const run = async (id: string, path: string, body: unknown) => {
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(null);
    setFailedTurn(null);
    setPartial('');
    setProgress('Thinking…');
    const current = () => selection.current === id && running.current === controller;
    try {
      await streamTurn(path, body, controller.signal, (event) => {
        if (!current()) return;
        if (event.type === 'delta') setPartial((text) => text + event.text);
        if (event.type === 'reset') setPartial('');
        if (event.type === 'status') setProgress(event.message);
      });
    } catch (cause) {
      if (current() && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The answer failed.');
    } finally {
      if (current()) {
        try {
          const [items, turn] = await Promise.all([
            loadMessages(id),
            request<Turn | null>(`/api/conversations/${id}/latest-turn`),
          ]);
          if (current()) {
            setMessages(items);
            setFailedTurn(failed(turn));
          }
          await refresh();
        } catch {
          if (current()) setError('Could not reload the saved answer. Reopen this conversation.');
        }
        if (current()) {
          running.current = null;
          setBusy(false);
          setPartial('');
        }
      }
    }
  };
  const send = async (text: string) => {
    if (running.current || loading) return;
    const id = selection.current ?? (await create());
    if (!id) return;
    setMessages((items) => [
      ...items,
      { id: crypto.randomUUID(), role: 'user', text, createdAt: Date.now() },
    ]);
    await run(id, `/api/conversations/${id}/messages`, {
      requestId: crypto.randomUUID(),
      text,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    setLoading(false);
  };
  const retry = async () => {
    if (selected && failedTurn && !running.current)
      await run(selected, `/api/conversations/${selected}/turns/${failedTurn}/retry`, {
        requestId: crypto.randomUUID(),
      });
  };
  const cancel = async () => {
    const id = selection.current;
    if (!id || !running.current) return;
    try {
      const turn = await request<Turn | null>(`/api/conversations/${id}/latest-turn`);
      if (turn && ['pending', 'running'].includes(turn.state))
        await request(`/api/conversations/${id}/turns/${turn.id}/cancel`, {
          method: 'POST',
          body: '{}',
        });
    } catch {
      if (selection.current === id) setError('Could not stop the answer. Try again.');
    }
  };
  return {
    conversations,
    selected,
    setSelected,
    messages,
    busy,
    loading,
    error,
    failedTurn,
    partial,
    progress,
    create,
    remove,
    send,
    retry,
    cancel,
  };
}
