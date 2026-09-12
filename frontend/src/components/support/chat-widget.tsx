import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Copy,
  CreditCard,
  HelpCircle,
  MessageCircle,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, post, postRaw } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export type SupportMessage = {
  id: string;
  sender: "user" | "admin";
  body: string;
  createdAt: string;
  readAt: string | null;
  imageUrl?: string | null;
};

// Mirrors backend/src/supportAttachments.js's SUPPORT_IMAGE_TYPES / 8mb limit
// — checked here too so a bad pick fails instantly instead of after a slow
// upload only to be rejected by the server.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Plan = { key: string; label: string; priceEgp: number; months: number };
type SubscribeInfo = {
  plans: Plan[];
  instapay: { address: string | null; accountName: string | null };
};

const POLL_MS = 15 * 1000;
const EG_NUMBER = new Intl.NumberFormat("ar-EG");

const time = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The questions the bot can answer without a human, each pointing at the page
 * that explains it properly. Anything not covered here funnels to "كلّمني مع
 * حد", so the fallback is always a person rather than a dead end.
 */
const TOPICS = [
  {
    q: "الأداة بتشتغل إزاي؟",
    a: "EGXpert بيقرأ محفظتك الحقيقية وأسعار البورصة اللحظية، وبيحسب لكل سهم وقف خسارة وهدفين وتوصية يومية حسب أسلوبك في الاستثمار.",
    to: "/",
    linkLabel: "الشرح التفصيلي",
  },
  {
    q: "إزاي أضيف أسهمي؟",
    a: 'من شاشة "الأسهم" تقدر تدخّل السهم يدويًا بالكمية ومتوسط سعر الشراء، أو ترفع لقطة شاشة من تطبيق السمسار وهي تتقرا تلقائيًا.',
    to: "/how-to-use",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: "يعني إيه وقف الخسارة والأهداف؟",
    a: "لكل سهم بنحسب سعر تخرج عنده لو السوق مشي ضدك (وقف الخسارة)، وهدفين للربح — محسوبين من حركة السهم نفسه ومن أسلوبك: مضارب، متوسط المدى، أو طويل المدى.",
    to: "/how-to-use",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: 'ليه لازم أضغط "سجّل إغلاق اليوم"؟',
    a: "لأنه اللي بيبني تاريخ محفظتك. الأسعار الحية بتتغيّر وبتمسح بعضها، والزرار ده بيحفظ لقطة ثابتة لليوم تظهر بعد كده في التقويم والرسوم.",
    to: "/how-to-use",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: "الأسعار كام؟",
    a: "شهري ١٤٩ جنيه، أو سنوي ١٥٩٩ جنيه — يعني بتوفّر ١٨٩ جنيه في السنة. والتجربة المجانية ٤ أيام بكل المزايا وبدون بطاقة.",
    to: "/pricing",
    linkLabel: "صفحة الأسعار",
  },
] as const;

type BotBubble = { id: string; side: "user" | "admin"; text: string; node?: React.ReactNode };
type Mode = "menu" | "topics" | "human";

/**
 * A guided bot in front of the human inbox. Most people arrive wanting one of
 * three things — to subscribe, to understand something, or to reach a person —
 * so it asks which, answers the first two itself, and only escalates the
 * third. That keeps the admin inbox to messages that actually need a reply,
 * and gets the subscriber their payment details instantly instead of waiting.
 */
export function ChatWidget() {
  const { user } = useDesk();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [bot, setBot] = useState<BotBubble[]>([]);
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const modeInitialized = useRef(false);

  const load = useCallback(async ({ markRead }: { markRead: boolean }) => {
    try {
      const { messages: list } = await api(`/api/support/messages${markRead ? "?read=1" : ""}`);
      setMessages(list);
      // An existing conversation means a person is already involved — skip
      // the menu and show it, rather than greeting them like a first visit.
      // Only on the first load though: later polls must not stomp on the
      // user navigating back to the menu with a thread already open.
      if (!modeInitialized.current) {
        if (list.length > 0) setMode("human");
        modeInitialized.current = true;
      }
      setUnread(
        markRead ? 0 : list.filter((m: SupportMessage) => m.sender === "admin" && !m.readAt).length,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل الرسائل");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load({ markRead: open });
    const timer = setInterval(() => void load({ markRead: open }), POLL_MS);
    return () => clearInterval(timer);
  }, [user, open, load]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages, bot, mode]);

  const say = (side: "user" | "admin", text: string, node?: React.ReactNode) =>
    setBot((previous) => [
      ...previous,
      { id: `${Date.now()}-${previous.length}`, side, text, node },
    ]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("اتنسخ");
    } catch {
      toast.error("تعذر النسخ — انسخه يدويًا");
    }
  };

  const chooseSubscribe = async () => {
    say("user", "عايز أشترك");
    try {
      const info: SubscribeInfo = await api("/api/support/subscribe-info");
      const prices = info.plans
        .map((p) => `${p.label}: ${EG_NUMBER.format(p.priceEgp)} جنيه`)
        .join(" · ");
      if (info.instapay.address) {
        say(
          "admin",
          `تمام! الأسعار: ${prices}.\nحوّل المبلغ على InstaPay على الحساب ده، وبعدها ابعتلنا صورة الإيصال هنا وهنفعّل اشتراكك على طول.`,
          <InstapayCard info={info.instapay} onCopy={copy} />,
        );
      } else {
        say(
          "admin",
          `تمام! الأسعار: ${prices}.\nاكتبلنا هنا الباقة اللي عايزها وحد مننا هيبعتلك بيانات التحويل حالًا.`,
        );
      }
      setMode("human");
    } catch {
      say("admin", "حصلت مشكلة وإحنا بنجيب بيانات الاشتراك. اكتبلنا هنا وهنبعتهالك.");
      setMode("human");
    }
  };

  const escalate = () => {
    say("user", "عايز أكلم حد مننا");
    say("admin", "تمام، اكتب رسالتك هنا وهنرد عليك في أقرب وقت.");
    setMode("human");
  };

  // Once a real message reaches support there is an actual thread to keep, so
  // this (and the button that calls it) only ever shows while it's still the
  // bot talking — going back to the menu once a real conversation exists
  // would otherwise plant the menu picker on top of that thread.
  const backToMenu = () => {
    setBot([]);
    setMode("menu");
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      // First message of a conversation is flagged as a help request so the
      // notification email says so.
      const { message } = await post("/api/support/messages", {
        body,
        intent: messages.length === 0 ? "help" : undefined,
      });
      setMessages((previous) => [...previous, message]);
      setDraft("");
      if (messages.length === 0) say("admin", "وصلتنا رسالتك — هنرد عليك في أقرب وقت.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إرسال الرسالة");
    } finally {
      setSending(false);
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);

  const sendImage = async (file: File) => {
    if (sending) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("لازم تكون صورة JPG أو PNG أو WEBP");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("الصورة كبيرة أوي (الحد ٨ ميجا)");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const wasEmpty = messages.length === 0;
      const { message } = await postRaw(
        `/api/support/messages/image${wasEmpty ? "?intent=help" : ""}`,
        file,
        file.type,
      );
      setMessages((previous) => [...previous, message]);
      if (wasEmpty) say("admin", "وصلتنا صورتك — هنرد عليك في أقرب وقت.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر رفع الصورة");
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
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
          <header className="flex items-center gap-2 border-b px-4 py-3">
            {/* Fixed in the header (not the scrolling thread) so it stays
                reachable once the conversation grows past one screen. Hidden
                once a real message exists — see backToMenu. */}
            {user && mode !== "menu" && messages.length === 0 && (
              <button
                type="button"
                onClick={backToMenu}
                aria-label="رجوع للخيارات"
                className="-ms-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowRight className="size-4" />
              </button>
            )}
            <div>
              <h2 className="text-[14px] font-semibold">تواصل معانا</h2>
              <p className="text-[11.5px] text-muted-foreground">
                للاشتراك أو أي استفسار — بنرد في أقرب وقت.
              </p>
            </div>
          </header>

          {/* A thread is keyed to an account, so there is nowhere to put a
              visitor's message — point them at the two things that do work. */}
          {!user ? (
            <div className="space-y-3 p-4">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                سجّل دخولك عشان تكلّمنا من هنا ونرد عليك في نفس المكان. لو لسه معندكش حساب، ابدأ
                تجربة مجانية ٤ أيام.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link to="/login" search={{ mode: "login" }}>
                    دخول
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/login" search={{ mode: "register" }}>
                    حساب جديد
                  </Link>
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                أو ابعتلنا من{" "}
                <Link to="/contact" className="font-medium text-primary hover:underline">
                  صفحة تواصل معنا
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="scrollbar-slim flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              <Bubble side="admin">أهلًا! تحب أساعدك في إيه؟</Bubble>

              {bot.map((bubble) => (
                <Bubble key={bubble.id} side={bubble.side}>
                  {bubble.text}
                  {bubble.node}
                </Bubble>
              ))}

              {mode === "menu" && (
                <div className="space-y-2 pt-1">
                  <Choice icon={CreditCard} onClick={() => void chooseSubscribe()}>
                    عايز أشترك
                  </Choice>
                  <Choice icon={HelpCircle} onClick={() => setMode("topics")}>
                    عندي سؤال مش فاهمه
                  </Choice>
                  <Choice icon={MessageCircle} onClick={escalate}>
                    عايز اكلم خدمة العملاء
                  </Choice>
                </div>
              )}

              {mode === "topics" && (
                <div className="space-y-2 pt-1">
                  <Bubble side="admin">سؤالك عن إيه؟</Bubble>
                  {TOPICS.map((topic) => (
                    <Choice
                      key={topic.q}
                      onClick={() => {
                        say("user", topic.q);
                        say("admin", topic.a, <TopicLink to={topic.to} label={topic.linkLabel} />);
                        setMode("human");
                      }}
                    >
                      {topic.q}
                    </Choice>
                  ))}
                  <Choice icon={MessageCircle} onClick={escalate}>
                    سؤالي مش موجود — كلّمني مع حد
                  </Choice>
                </div>
              )}

              {messages.map((message) => (
                <Bubble key={message.id} side={message.sender} at={message.createdAt}>
                  {message.imageUrl && (
                    <a href={message.imageUrl} target="_blank" rel="noreferrer">
                      <img
                        src={message.imageUrl}
                        alt="مرفق"
                        className="max-h-48 rounded-lg object-contain"
                      />
                    </a>
                  )}
                  {message.body}
                </Bubble>
              ))}
              <div ref={endRef} />
            </div>
          )}

          {user && mode === "human" && (
            <>
              {error && <p className="px-4 pb-2 text-[12px] text-down">{error}</p>}

              <div className="flex items-end gap-2 border-t p-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMAGE_TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void sendImage(file);
                  }}
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                  aria-label="إرفاق صورة"
                >
                  <Paperclip className="size-4" />
                </Button>
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  onPaste={(event) => {
                    const file = [...event.clipboardData.files].find((f) => IMAGE_TYPES.includes(f.type));
                    if (file) void sendImage(file);
                  }}
                  placeholder="اكتب رسالتك… أو الصق/ارفق صورة"
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
            </>
          )}
        </section>
      )}
    </>
  );
}

function Bubble({
  side,
  at,
  children,
}: {
  side: "user" | "admin";
  at?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
        side === "user" ? "ms-auto bg-primary text-primary-foreground" : "me-auto bg-secondary",
      )}
    >
      <div className="whitespace-pre-wrap break-words">{children}</div>
      {at && (
        <p
          className={cn(
            "num mt-1 text-[10.5px]",
            side === "user" ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {time(at)}
        </p>
      )}
    </div>
  );
}

function Choice({
  icon: Icon,
  onClick,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-start text-[13px] font-medium transition-colors hover:border-primary/50 hover:bg-accent"
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      {children}
    </button>
  );
}

function TopicLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
    >
      {label}
      <ArrowRight className="size-3.5 rotate-180" />
    </Link>
  );
}

function InstapayCard({
  info,
  onCopy,
}: {
  info: { address: string | null; accountName: string | null };
  onCopy: (text: string) => void;
}) {
  if (!info.address) return null;
  return (
    <div className="mt-2 rounded-lg border bg-card p-2.5">
      <p className="text-[11px] text-muted-foreground">حساب InstaPay</p>
      <code className="mt-0.5 block text-[13px] font-semibold text-foreground" dir="ltr">
        {info.address}
      </code>
      {info.accountName && (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{info.accountName}</p>
      )}
      <Button
        size="sm"
        variant="outline"
        className="mt-2 h-7 px-2 text-[12px]"
        onClick={() => onCopy(info.address as string)}
      >
        <Copy className="size-3.5" />
        نسخ
      </Button>
    </div>
  );
}
