import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Copy,
  CreditCard,
  HelpCircle,
  History,
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
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { api, post, postRaw } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { useTenant, withBrand } from "@/lib/tenant";
import { cn } from "@/lib/utils";
import { useWhatsappNumber, WhatsAppIcon } from "@/components/support/whatsapp";

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
// With the panel closed the poll only keeps the unread badge current, which
// can lag a minute — and every signed-in visitor runs this poll.
const CLOSED_POLL_MS = 60 * 1000;

// The "اسألنا" nudge: a pulsing ring on the launcher plus a small bubble above
// it. It waits a few seconds so it doesn't land on top of a page that's still
// loading, and it shows on every page load — opening the chat or closing the
// bubble only dismisses it until the next load, nothing is remembered.
const NUDGE_DELAY_MS = 4000;

// The X on the launcher stack folds the WhatsApp and chat buttons away into a
// slim tab on the screen edge. Remembered across visits so a person who hid
// them doesn't have to do it on every page; the tab is always there to undo it.
const COLLAPSED_KEY = "alytic-chat-collapsed";

const readCollapsed = () => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

const writeCollapsed = (collapsed: boolean) => {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Storage blocked (private mode): it simply resets on the next visit.
  }
};

const EG_NUMBER = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

const time = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
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
    hash: "how-it-works",
    linkLabel: "الشرح التفصيلي",
  },
  {
    q: "إزاي أضيف أسهمي؟",
    a: 'من شاشة "الأسهم" تقدر تدخّل السهم يدويًا بالكمية ومتوسط سعر الشراء، أو ترفع لقطة شاشة من تطبيق السمسار وهي تتقرا تلقائيًا.',
    to: "/how-to-use",
    hash: "start",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: "يعني إيه وقف الخسارة والأهداف؟",
    a: "لكل سهم بنحسب سعر تخرج عنده لو السوق مشي ضدك (وقف الخسارة)، وهدفين للربح — محسوبين من حركة السهم نفسه ومن أسلوبك: مضارب، متوسط المدى، أو طويل المدى.",
    to: "/how-to-use",
    hash: "recommendations",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: "أستخدم التوصيات إزاي؟",
    a: 'على كل سهم في "الأسهم" توصية لليوم (احتفاظ، بيع جزئي، جني أرباح، خروج) ومعاها سطر "الأمر" بالكمية والسعر. نفّذه بأمر محدد من تطبيق السمسار، وبعدها سجّل الصفقة من "إدخال يدوي". ولو عايز رأي أعمق دوس "قولي توصية اليوم".',
    to: "/how-to-use",
    hash: "recommendations",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: "تحليل الكاش بيعمل إيه؟",
    a: 'من شاشة "تحليل الكاش" حدّث رصيدك ودوس "حلل الكاش" — هيتحفظ الرصيد وهيقترح أسهم بعدد وسعر دخول ووقف وهدف وتكلفة لكل سهم، مع احتياطي، وعلى كل سهم رأي: اشتري دلوقتي، على تصحيح، استنى، أو سيبه.',
    to: "/how-to-use",
    hash: "cash-analysis",
    linkLabel: "دليل الاستخدام",
  },
  {
    q: "الأسعار كام؟",
    a: "باقة النفس الطويل ٢٩٩ جنيه شهريًا أو ٢٩٩٠ جنيه سنويًا، وباقة الحريفة ٤٩٩ جنيه شهريًا أو ٤٩٩٠ جنيه سنويًا — كل باقة بحدود استخدام شهرية مختلفة. والتجربة المجانية ٥ أيام تداول بحدودها الخاصة وبدون بطاقة.",
    to: "/pricing",
    hash: "",
    linkLabel: "صفحة الأسعار",
  },
  {
    q: "خلصت رصيد ميزة الشهر ده، أعمل إيه؟",
    a: "الرصيد بيتجدد أول كل شهر ميلادي. لو محتاج رصيد قبل كده، قولّنا في الشات أنهي ميزة وهنشوف معاك. وتقدر تشوف رصيدك في كل ميزة من صفحة «البروفايل والإعدادات».",
    to: "/settings",
    hash: "",
    linkLabel: "البروفايل والإعدادات",
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
  const { name: brandName } = useTenant();
  const { user } = useDesk();
  const whatsappNumber = useWhatsappNumber();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [bot, setBot] = useState<BotBubble[]>([]);
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  // Starts false and only flips in an effect, so the server-rendered markup and
  // the first client render agree.
  const [nudge, setNudge] = useState(false);
  // null until the saved choice is read on the client, so nothing flashes in
  // the wrong state (localStorage doesn't exist on the server).
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const modeInitialized = useRef(false);
  // How many real messages existed when the current bot "session" started —
  // 0 until "back to menu" is used. Generalizes every "is this the first
  // message yet" check below from a global count to a per-session one, so
  // going back after a real thread already exists behaves exactly like a
  // first-time visit instead of being compared against the whole thread's
  // history. Everything before this index stays hidden behind the menu's
  // "المحادثة السابقة" choice instead of sharing the view with the new session.
  const [branchAt, setBranchAt] = useState(0);

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
  }, [user, open, load]);
  useVisibleInterval(
    () => void load({ markRead: open }),
    open ? POLL_MS : CLOSED_POLL_MS,
    Boolean(user),
  );

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages, bot, mode]);

  useEffect(() => {
    const timer = setTimeout(() => setNudge(true), NUDGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => setCollapsed(readCollapsed()), []);

  const stopNudge = () => setNudge(false);
  const collapse = () => {
    stopNudge();
    setCollapsed(true);
    writeCollapsed(true);
  };
  const expand = () => {
    // The nudge timer keeps running while collapsed; don't greet the person
    // with a bubble the moment they bring the buttons back themselves.
    stopNudge();
    setCollapsed(false);
    writeCollapsed(false);
  };
  // Unread replies already have the red badge, which matters more than an
  // invitation to ask; staff don't need inviting to their own inbox.
  const showNudge = nudge && !open && unread === 0 && !user?.isAdmin;

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

  // Always available, and always starts a clean, separate chat rather than
  // reopening the menu on top of whatever's already on screen: clears the
  // bot's own bubbles and moves branchAt to the end of the real thread so
  // far. Nothing is deleted — the menu offers everything up to that point
  // back as "المحادثة السابقة" (see resumePrevious).
  const backToMenu = () => {
    setBot([]);
    setBranchAt(messages.length);
    setMode("menu");
  };

  // Reopens the whole thread as the live conversation, composer included, so
  // a reply continues it rather than opening a new help request.
  const resumePrevious = () => {
    setBot([]);
    setBranchAt(0);
    setMode("human");
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      // First message of a session (the whole thread, or since the last "new
      // topic") is flagged as a help request so the notification email says so.
      const isFirstOfSession = messages.length === branchAt;
      const { message } = await post("/api/support/messages", {
        body,
        intent: isFirstOfSession ? "help" : undefined,
      });
      setMessages((previous) => [...previous, message]);
      setDraft("");
      if (isFirstOfSession) say("admin", "وصلتنا رسالتك — هنرد عليك في أقرب وقت.");
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
      const isFirstOfSession = messages.length === branchAt;
      const { message } = await postRaw(
        `/api/support/messages/image${isFirstOfSession ? "?intent=help" : ""}`,
        file,
        file.type,
      );
      setMessages((previous) => [...previous, message]);
      if (isFirstOfSession) say("admin", "وصلتنا صورتك — هنرد عليك في أقرب وقت.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر رفع الصورة");
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (collapsed === null) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={expand}
        aria-label="إظهار أزرار التواصل"
        className="fixed bottom-20 start-0 z-50 flex h-14 w-9 items-center justify-center rounded-e-2xl bg-primary text-primary-foreground shadow-lg transition-[width] hover:w-11 md:bottom-6"
      >
        <MessageCircle className="size-5" />
        {unread > 0 && (
          <span className="num absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-down text-[11px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      {showNudge && (
        <>
          {/* Same spot and size as the launcher, one layer below it: the ring
              swells and fades behind the button, over and over. Dropped for
              anyone who asked their system for less motion — the bubble
              below still tells them. */}
          <span
            aria-hidden
            className="pointer-events-none fixed bottom-20 start-4 z-40 size-14 animate-ping rounded-full bg-primary/40 md:bottom-6 motion-reduce:hidden"
          />
          <div
            role="status"
            className="animate-in fade-in slide-in-from-bottom-2 fixed bottom-[13.75rem] start-4 z-50 flex w-[min(15rem,calc(100vw-2rem))] items-start gap-1 rounded-2xl border bg-card p-2 shadow-xl duration-300 md:bottom-[10.25rem]"
          >
            <button
              type="button"
              onClick={() => {
                stopNudge();
                setOpen(true);
              }}
              className="flex-1 rounded-lg px-2 py-1 text-start text-[13px] leading-relaxed hover:bg-muted"
            >
              <span className="block font-semibold">محتاج تستفسر عن حاجة؟</span>
              <span className="text-muted-foreground">اسألنا — إحنا هنا نساعدك.</span>
            </button>
            <button
              type="button"
              onClick={stopNudge}
              aria-label="إخفاء التنبيه"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </>
      )}
      <Button
        onClick={() => {
          stopNudge();
          setOpen((previous) => !previous);
        }}
        aria-label={open ? "إغلاق الدردشة" : "تواصل معانا"}
        className="fixed bottom-20 start-4 z-50 size-14 rounded-full p-0 shadow-lg md:bottom-6"
      >
        {open ? <X className="size-9" /> : <MessageCircle className="size-9" />}
        {!open && unread > 0 && (
          <span className="num absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full bg-down text-[11px] font-semibold text-white">
            {unread}
          </span>
        )}
      </Button>
      {/* Stacked above the launcher; the nudge bubble and chat panel sit above
          this in turn. */}
      <a
        href={`https://wa.me/${whatsappNumber}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="تواصل معانا على واتساب"
        className="fixed bottom-[9.25rem] start-4 z-50 grid size-14 place-items-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 md:bottom-[5.75rem]"
      >
        <WhatsAppIcon className="size-8" />
      </a>
      {!open && (
        <button
          type="button"
          onClick={collapse}
          aria-label="إخفاء أزرار التواصل"
          className="fixed bottom-[11.375rem] start-[3.125rem] z-[51] grid size-7 place-items-center rounded-full border bg-card text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground md:bottom-[7.875rem]"
        >
          <X className="size-4" />
        </button>
      )}

      {open && (
        <section
          className="fixed bottom-[13.75rem] start-4 z-50 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl md:bottom-[10.25rem]"
          aria-label="الدردشة مع الدعم"
        >
          <header className="flex items-center gap-2 border-b px-4 py-3">
            {/* Fixed in the header (not the scrolling thread) so it stays
                reachable once the conversation grows past one screen. Always
                available, not just before a real message exists — see
                backToMenu for how it stays a clean, separate chat instead of
                landing on top of whatever's already on screen. */}
            {user && mode !== "menu" && (
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
                تجربة مجانية ٥ أيام تداول.
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
                  {branchAt > 0 && (
                    <Choice icon={History} onClick={resumePrevious}>
                      المحادثة السابقة
                    </Choice>
                  )}
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
                        say(
                          "admin",
                          withBrand(topic.a, brandName),
                          <TopicLink
                            to={topic.to}
                            hash={topic.hash}
                            label={topic.linkLabel}
                            onNavigate={() => setOpen(false)}
                          />,
                        );
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

              {messages.slice(branchAt).map((message) => (
                <MessageBubble key={message.id} message={message} />
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
                    const file = [...event.clipboardData.files].find((f) =>
                      IMAGE_TYPES.includes(f.type),
                    );
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

function MessageBubble({ message }: { message: SupportMessage }) {
  return (
    <Bubble side={message.sender} at={message.createdAt}>
      {message.imageUrl && (
        <a href={message.imageUrl} target="_blank" rel="noreferrer">
          <img src={message.imageUrl} alt="مرفق" className="max-h-48 rounded-lg object-contain" />
        </a>
      )}
      {message.body}
    </Bubble>
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

/**
 * Closes the chat on click, since it covers most of the page on a phone. A
 * link to the page the visitor is already on is a no-op for the router, so
 * that case scrolls to the section itself instead of looking dead.
 */
function TopicLink({
  to,
  hash,
  label,
  onNavigate,
}: {
  to: string;
  hash: string;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      {...(hash ? { hash } : {})}
      onClick={(event) => {
        onNavigate();
        if (window.location.pathname !== to) return;
        event.preventDefault();
        const target = hash ? document.getElementById(hash) : null;
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}
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
  const isLink = /^https?:\/\//i.test(info.address);
  return (
    <div className="mt-2 rounded-lg border bg-card p-2.5">
      <p className="text-[11px] text-muted-foreground">
        {isLink ? "لينك دفع InstaPay" : "حساب InstaPay"}
      </p>
      {!isLink && (
        <code className="mt-0.5 block text-[13px] font-semibold text-foreground" dir="ltr">
          {info.address}
        </code>
      )}
      {info.accountName && (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{info.accountName}</p>
      )}
      <div className="mt-2 flex gap-2">
        {isLink && (
          <Button asChild size="sm" className="h-7 px-2 text-[12px]">
            <a href={info.address} target="_blank" rel="noopener noreferrer">
              ادفع دلوقتي
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[12px]"
          onClick={() => onCopy(info.address as string)}
        >
          <Copy className="size-3.5" />
          {isLink ? "نسخ اللينك" : "نسخ"}
        </Button>
      </div>
    </div>
  );
}
