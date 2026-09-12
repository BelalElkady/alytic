import { MessageCircle, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, post } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export type SupportMessage = {
  id: string;
  sender: "user" | "admin";
  body: string;
  createdAt: string;
  readAt: string | null;
};

const POLL_MS = 15 * 1000;

const time = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The support chat, and the only place subscription details are handed over —
 * they're never published on a page. Reachable even when the paywall has
 * replaced the desk, since a lapsed user needs it to arrange a renewal.
 *
 * Polls rather than holding a socket: messages are answered by a human in
 * minutes, so a 15s poll while the panel is open is more than enough and
 * costs nothing to operate.
 */
export function ChatWidget() {
  const { user } = useDesk();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async ({ markRead }: { markRead: boolean }) => {
    try {
      const { messages: list } = await api(`/api/support/messages${markRead ? "?read=1" : ""}`);
      setMessages(list);
      setUnread(
        markRead ? 0 : list.filter((m: SupportMessage) => m.sender === "admin" && !m.readAt).length,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل الرسائل");
    }
  }, []);

  // Polls while closed too, so a reply raises the badge without the user
  // opening anything. read=1 is only sent when the panel is open — otherwise
  // the poll itself would clear the badge before it was ever seen.
  useEffect(() => {
    if (!user) return;
    void load({ markRead: open });
    const timer = setInterval(() => void load({ markRead: open }), POLL_MS);
    return () => clearInterval(timer);
  }, [user, open, load]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages]);

  if (!user) return null;

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const { message } = await post("/api/support/messages", { body });
      setMessages((previous) => [...previous, message]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إرسال الرسالة");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen((previous) => !previous)}
        aria-label={open ? "إغلاق الدردشة" : "تواصل معانا"}
        className="fixed bottom-20 start-4 z-50 size-12 rounded-full p-0 shadow-lg md:bottom-6"
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
        {!open && unread > 0 && (
          <span className="num absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full bg-down text-[11px] font-semibold text-white">
            {unread}
          </span>
        )}
      </Button>

      {open && (
        <section
          className="fixed bottom-36 start-4 z-50 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl md:bottom-22"
          aria-label="الدردشة مع الدعم"
        >
          <header className="border-b px-4 py-3">
            <h2 className="text-[14px] font-semibold">تواصل معانا</h2>
            <p className="text-[11.5px] text-muted-foreground">
              للاشتراك أو أي استفسار — بنرد في أقرب وقت.
            </p>
          </header>

          <div className="scrollbar-slim flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {messages.length === 0 && !error && (
              <p className="py-6 text-center text-[12.5px] leading-relaxed text-muted-foreground">
                ابعتلنا رسالتك وهنرد عليك هنا. لو عايز تشترك، اكتبلنا وهنبعتلك بيانات الدفع
                والتفاصيل كلها.
              </p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                  message.sender === "user"
                    ? "ms-auto bg-primary text-primary-foreground"
                    : "me-auto bg-secondary",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p
                  className={cn(
                    "num mt-1 text-[10.5px]",
                    message.sender === "user"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground",
                  )}
                >
                  {time(message.createdAt)}
                </p>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {error && <p className="px-4 pb-2 text-[12px] text-down">{error}</p>}

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
              placeholder="اكتب رسالتك…"
              rows={2}
              className="min-h-0 resize-none text-[13px]"
            />
            <Button
              size="icon"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              aria-label="إرسال"
            >
              {sending ? <Spinner /> : <Send className="size-4" />}
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
