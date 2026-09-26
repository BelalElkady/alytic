import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingBlock, Spinner } from "@/components/desk/state-blocks";
import type { SupportMessage } from "@/components/support/chat-widget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { api, post } from "@/lib/api";
import { cn } from "@/lib/utils";

type Thread = {
  userId: string;
  email: string;
  name: string;
  lastMessage: string;
  lastSender: "user" | "admin";
  lastAt: string;
  unread: number;
};

const POLL_MS = 20 * 1000;

const time = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  });

/** The admin side of the in-app chat — where subscription requests are answered and payment details are sent privately. */
export function SupportTab() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const { threads: list } = await api("/api/admin/support");
      setThreads(list);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل المحادثات");
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);
  useVisibleInterval(() => void loadThreads(), POLL_MS);

  if (error)
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="outline" size="sm" onClick={() => void loadThreads()}>
            حاول تاني
          </Button>
        }
      />
    );
  if (!threads) return <LoadingBlock rows={3} />;
  if (threads.length === 0)
    return <EmptyState title="مفيش محادثات" hint="أول ما مستخدم يبعت رسالة هتظهر هنا." />;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="scrollbar-slim max-h-[32rem] space-y-1.5 overflow-y-auto">
        {threads.map((thread) => (
          <button
            key={thread.userId}
            type="button"
            onClick={() => setActiveId(thread.userId)}
            className={cn(
              "w-full rounded-xl border bg-card p-3 text-start transition-colors",
              activeId === thread.userId
                ? "border-primary/60 ring-1 ring-primary/20"
                : "hover:bg-accent",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{thread.email}</span>
              {thread.unread > 0 && <Badge variant="destructive">{thread.unread}</Badge>}
            </div>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">
              {thread.lastSender === "admin" ? "أنت: " : ""}
              {thread.lastMessage}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {time(thread.lastAt)}
            </p>
          </button>
        ))}
      </div>

      {activeId ? (
        <ThreadPanel userId={activeId} onSent={loadThreads} />
      ) : (
        <EmptyState title="اختر محادثة" hint="اضغط على مستخدم من القائمة عشان تشوف الرسايل وترد." />
      )}
    </div>
  );
}

function ThreadPanel({ userId, onSent }: { userId: string; onSent: () => void }) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { messages: list } = await api(`/api/admin/support/${userId}`);
      setMessages(list);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تحميل المحادثة");
    }
  }, [userId]);

  useEffect(() => {
    setMessages(null);
    void load();
  }, [load]);
  useVisibleInterval(() => void load(), POLL_MS);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { message } = await post(`/api/admin/support/${userId}`, { body });
      setMessages((previous) => [...(previous ?? []), message]);
      setDraft("");
      onSent();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر إرسال الرد");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex max-h-[32rem] flex-col rounded-xl border bg-card">
      <div className="scrollbar-slim flex-1 space-y-2.5 overflow-y-auto p-4">
        {messages === null ? (
          <LoadingBlock rows={3} />
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                message.sender === "admin"
                  ? "ms-auto bg-primary text-primary-foreground"
                  : "me-auto bg-secondary",
              )}
            >
              {message.imageUrl && (
                <a href={message.imageUrl} target="_blank" rel="noreferrer">
                  <img
                    src={message.imageUrl}
                    alt="مرفق"
                    className="max-h-56 rounded-lg object-contain"
                  />
                </a>
              )}
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p
                className={cn(
                  "mt-1 text-[10.5px] tabular-nums",
                  message.sender === "admin"
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {time(message.createdAt)}
              </p>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="اكتب ردك… (Enter للإرسال)"
          rows={2}
          className="min-h-0 resize-none text-[13px]"
        />
        <Button size="icon" onClick={() => void send()} disabled={sending || !draft.trim()}>
          {sending ? <Spinner /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
