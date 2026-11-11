import { useCallback, useEffect, useState } from 'react';

type Conversation = { id: string; title: string; updatedAt: number };
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
};
type Turn = { id: string; state: string };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
export function useConversations(enabled: boolean) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const page = await request<{ items: Conversation[] }>('/api/conversations?limit=100');
    setConversations(page.items);
    setSelected((current) =>
      current && page.items.some((item) => item.id === current)
        ? current
        : (page.items[0]?.id ?? null),
    );
  }, []);
  useEffect(() => {
    if (enabled) void refresh().catch((cause) => setError(String(cause)));
  }, [enabled, refresh]);
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      setFailedTurn(null);
      return;
    }
    let active = true;
    void request<{ items: ChatMessage[] }>(`/api/conversations/${selected}/messages?limit=100`)
      .then((page) => {
        if (active) setMessages(page.items);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    void request<Turn | null>(`/api/conversations/${selected}/latest-turn`)
      .then((turn) => {
        if (active)
          setFailedTurn(
            turn && ['failed', 'cancelled', 'interrupted'].includes(turn.state) ? turn.id : null,
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selected]);
  const create = async () => {
    try {
      setError(null);
      const conversation = await request<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: 'New conversation' }),
      });
      setConversations((items) => [conversation, ...items]);
      setSelected(conversation.id);
      setMessages([]);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const remove = async (id: string) => {
    try {
      await request(`/api/conversations/${id}`, { method: 'DELETE' });
      setConversations((items) => items.filter((item) => item.id !== id));
      if (selected === id) setSelected(null);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const send = async (text: string) => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setFailedTurn(null);
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      createdAt: Date.now(),
    };
    setMessages((items) => [...items, optimistic]);
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await request(`/api/conversations/${selected}/messages`, {
        method: 'POST',
        body: JSON.stringify({ requestId: crypto.randomUUID(), text, timezone: zone }),
      });
      const page = await request<{ items: ChatMessage[] }>(
        `/api/conversations/${selected}/messages?limit=100`,
      );
      setMessages(page.items);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The answer failed.');
      const page = await request<{ items: ChatMessage[] }>(
        `/api/conversations/${selected}/messages?limit=100`,
      ).catch(() => null);
      if (page) setMessages(page.items);
      const turn = await request<Turn | null>(`/api/conversations/${selected}/latest-turn`).catch(
        () => null,
      );
      if (turn && ['failed', 'cancelled', 'interrupted'].includes(turn.state))
        setFailedTurn(turn.id);
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!selected || !failedTurn || busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(`/api/conversations/${selected}/turns/${failedTurn}/retry`, {
        method: 'POST',
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      const page = await request<{ items: ChatMessage[] }>(
        `/api/conversations/${selected}/messages?limit=100`,
      );
      setMessages(page.items);
      setFailedTurn(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retry failed.');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!selected || !busy) return;
    try {
      const turn = await request<Turn | null>(`/api/conversations/${selected}/latest-turn`);
      if (turn && ['pending', 'running'].includes(turn.state))
        await request(`/api/conversations/${selected}/turns/${turn.id}/cancel`, {
          method: 'POST',
          body: '{}',
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not cancel the answer.');
    }
  };
  return {
    conversations,
    selected,
    setSelected,
    messages,
    busy,
    error,
    failedTurn,
    create,
    remove,
    send,
    retry,
    cancel,
  };
}
