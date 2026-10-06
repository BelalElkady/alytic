import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { Tour, type TourStep } from "@/components/tour/tour";
import { useDesk } from "@/lib/store";

/**
 * The tour of the main screen (/portfolio). Each `target` is a `data-tour`
 * attribute on the part it explains; a part that isn't on the page for this
 * User (no positions yet, one wallet) drops its step — see Tour.
 */
const STEPS: TourStep[] = [
  {
    title: "أهلًا بيك — جولة سريعة",
    body: "في أقل من دقيقة هنوريك كل جزء في الشاشة الرئيسية بيعمل إيه. تقدر تتخطّاها في أي وقت وترجعلها من صفحة «طريقة الاستخدام».",
  },
  {
    target: "upload",
    title: "ارفع صور محفظتك",
    body: "أسرع طريقة تبدأ بيها: صوّر محفظتك من تطبيق شركة السمسرة وارفع الصورة، وإحنا هنقرا الأسهم والكميات ومتوسط التكلفة لوحدنا.",
  },
  {
    target: "manual",
    title: "أو سجّل يدويًا",
    body: "من هنا تسجّل صفقة شراء أو بيع جديدة، أو تعدّل الكمية ومتوسط التكلفة والكاش بإيدك.",
  },
  {
    target: "wallets",
    title: "محافظك",
    body: "كل محفظة ليها أسلوبها وكاشها وربحها. اضغط على محفظة عشان تنتقل ليها، ومن «⋯» تعدّل اسمها أو أسلوبها.",
  },
  {
    target: "totals",
    title: "ملخص المحفظة",
    body: "التكلفة الكلية، قيمة أسهمك دلوقتي، الربح أو الخسارة من الشراء، تغيّر اليوم، والكاش — كلها بالسعر اللحظي للمحفظة المختارة.",
  },
  {
    target: "alerts",
    title: "التنبيهات",
    body: "أول حاجة تبص عليها: سهم قفل تحت وقف الخسارة، سهم قرّب من الوقف، أو سهم وصل هدفه. لو مفيش حاجة هتلاقيها خضرا.",
  },
  {
    target: "daily-reco",
    title: "توصية اليوم",
    body: "بضغطة واحدة تاخد توصية اليوم لكل أسهمك: احتفاظ، بيع جزئي، جني أرباح أو خروج — حسب أسلوب المحفظة.",
  },
  {
    target: "position",
    title: "كارت السهم",
    body: "لكل سهم: السعر، ربحك أو خسارتك، وقف الخسارة، الهدف والتوصية. اضغط على الكارت عشان تفتح التحليل الكامل والرسم.",
  },
  {
    target: "market",
    title: "تحليل السوق",
    body: "ترتيب أسهم البورصة حسب التقييم والفرص القابلة للتنفيذ دلوقتي، مع بحث عن أي سهم بالكود أو الاسم.",
  },
  {
    target: "nav",
    title: "باقي الصفحات",
    body: "المؤشرات، أهداف أسهمك، تقويم الأرباح اليومي، الرسوم، وتحليل الكاش اللي بيقترح توزّع كاشك على إيه — كلها من هنا.",
  },
  {
    title: "كده خلصنا",
    body: "ابدأ برفع صور محفظتك أو تسجيل أول صفقة. ولو حبيت تعيد الجولة، هتلاقيها في صفحة «طريقة الاستخدام».",
  },
];

const TOUR_PATH = "/portfolio";
/** Set by anything that wants the tour replayed (the how-to-use page), read once here. */
export const TOUR_REQUEST_KEY = "alytic-tour-request";
// Per User, not per browser profile: two accounts on one machine each get it once.
const seenKey = (userId: string) => `alytic-tour-main-seen:${userId}`;

const read = (storage: Storage, key: string) => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};
const write = (storage: Storage, key: string, value: string | null) => {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage blocked: the tour just shows again next time.
  }
};

/** Asks for the main tour to run the next time the main screen is showing. */
export function requestMainTour() {
  write(sessionStorage, TOUR_REQUEST_KEY, "1");
}

/**
 * Runs the main-screen tour once per User, the first time the main screen is
 * showing with its data loaded and nothing else demanding attention — and
 * again whenever it's asked for. Mounted once, in the desk shell.
 */
export function MainTour() {
  const { user, loading } = useDesk();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const userId = user?.["id"] as string | undefined;
  const ready = Boolean(userId) && user?.hasAccess !== false && !loading && pathname === TOUR_PATH;

  useEffect(() => {
    if (!userId || user?.hasAccess === false || open) return;
    // Asked for from another page: go to the screen the tour is about.
    if (read(sessionStorage, TOUR_REQUEST_KEY) && pathname !== TOUR_PATH) void navigate({ to: TOUR_PATH });
  }, [userId, user?.hasAccess, pathname, navigate, open]);

  useEffect(() => {
    if (!ready || open || !userId) return;
    const requested = Boolean(read(sessionStorage, TOUR_REQUEST_KEY));
    if (!requested && read(localStorage, seenKey(userId))) return;
    // Wait out anything modal (the phone / style prompts, an announcement)
    // rather than opening on top of it.
    const start = () => {
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      write(sessionStorage, TOUR_REQUEST_KEY, null);
      setOpen(true);
    };
    const first = window.setTimeout(start, 600);
    const retry = window.setInterval(start, 1500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(retry);
    };
  }, [ready, open, userId]);

  const close = useCallback(() => {
    setOpen(false);
    if (userId) write(localStorage, seenKey(userId), new Date().toISOString());
  }, [userId]);

  return <Tour steps={STEPS} open={open} onClose={close} />;
}
