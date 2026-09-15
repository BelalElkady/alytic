import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { canonical, SITE_URL } from "@/lib/seo";

const DESCRIPTION =
  "سياسة الخصوصية في EGXpert: البيانات اللي بنجمعها، إزاي بنستخدمها، الإعلانات والكوكيز، وحقوقك تجاه بياناتك.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "سياسة الخصوصية — EGXpert" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "سياسة الخصوصية — EGXpert" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: `${SITE_URL}/privacy` },
    ],
    links: [canonical("/privacy")],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = "١٥ سبتمبر ٢٠٢٦";

const linkClass = "font-medium text-foreground underline underline-offset-4 hover:text-primary";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 ps-5 marker:text-muted-foreground/60">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function PrivacyPage() {
  return (
    <SiteShell>
      <section className="border-b bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <Badge variant="outline">آخر تحديث: {LAST_UPDATED}</Badge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl">
            سياسة الخصوصية
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            نحن في EGXpert نهتم بخصوصية مستخدمينا، وهذه الصفحة توضح البيانات التي نجمعها، وكيف
            نستخدمها، وحقوقك تجاهها.
          </p>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <Section title="البيانات اللي بنجمعها">
          <p>عند استخدامك للموقع أو الأداة، ممكن نجمع الأنواع التالية من البيانات:</p>
          <Bullets
            items={[
              <>
                <strong className="text-foreground">بيانات الحساب:</strong> الاسم، البريد
                الإلكتروني، وكلمة المرور (مشفّرة) عند إنشاء حساب.
              </>,
              <>
                <strong className="text-foreground">بيانات المحفظة:</strong> الأسهم اللي بتضيفها
                يدويًا، أو الصور اللي بترفعها لمحفظتك من تطبيق السمسار عشان نقرأها ونحدّث مراكزك.
              </>,
              <>
                <strong className="text-foreground">بيانات الاستخدام:</strong> الصفحات اللي
                بتزورها، والوقت اللي بتقضيه على الموقع، ونوع الجهاز والمتصفح.
              </>,
              <>
                <strong className="text-foreground">بيانات الدفع:</strong> الاشتراك بيتم بتحويل
                على InstaPay، وبنحتفظ ببيانات التحويل اللي بتبعتها لنا (زي صورة إيصال التحويل) عشان
                نتأكد منه ونفعّل حسابك. إحنا مش بنطلب ولا بنخزّن بيانات بطاقتك البنكية.
              </>,
            ]}
          />
        </Section>

        <Section title="إزاي بنستخدم البيانات دي">
          <Bullets
            items={[
              "تشغيل الأداة وحساب التوصيات ووقف الخسارة والأهداف بناءً على محفظتك.",
              "تحسين تجربة الاستخدام وتطوير مميزات جديدة.",
              "التواصل معاك بخصوص حسابك، تحديثات مهمة، أو الرد على استفساراتك.",
              "عرض إعلانات عن طريق شركاء إعلانيين مثل Google AdSense (تفاصيل أكتر تحت).",
            ]}
          />
        </Section>

        <Section title="الإعلانات وملفات تعريف الارتباط (Cookies)">
          <p>
            بنستخدم Google AdSense لعرض إعلانات على الموقع. Google وشركاؤه ممكن يستخدموا كوكيز عشان
            يعرضوا إعلانات بناءً على زياراتك لموقعنا أو مواقع تانية على الإنترنت.
          </p>
          <Bullets
            items={[
              <>
                تقدر تتحكم في الإعلانات المخصصة اللي بتظهرلك من خلال{" "}
                <a
                  href="https://adssettings.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  إعدادات إعلانات Google
                </a>
                .
              </>,
              <>
                لمزيد من التفاصيل عن إزاي جوجل بتستخدم البيانات، راجع{" "}
                <a
                  href="https://policies.google.com/technologies/partner-sites"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  صفحة سياسات شركاء جوجل
                </a>
                .
              </>,
            ]}
          />
          <p>
            بنستخدم كمان كوكيز أساسية لتشغيل الموقع (زي تسجيل الدخول)، وممكن نستخدم أدوات تحليل
            (Analytics) لفهم إزاي بيُستخدم الموقع.
          </p>
        </Section>

        <Section title="مشاركة البيانات مع أطراف تالتة">
          <p>إحنا مش بنبيع بياناتك الشخصية. بنشارك بيانات محدودة فقط مع:</p>
          <Bullets
            items={[
              "مزوّدي خدمات ضروريين لتشغيل الموقع (استضافة، إرسال البريد الإلكتروني، تحليلات، ومزوّدي الذكاء الاصطناعي اللي بيقروا صور المحفظة اللي بترفعها ويكتبوا التحليلات).",
              "شركاء إعلانيين (Google AdSense) بالقدر اللازم لعرض الإعلانات.",
              "الجهات القانونية لو طُلب منا ذلك بموجب القانون.",
            ]}
          />
        </Section>

        <Section title="حقوقك">
          <p>تقدر في أي وقت:</p>
          <Bullets
            items={[
              "تطلب نسخة من بياناتك المخزنة عندنا.",
              "تطلب تعديل أو تصحيح بياناتك.",
              "تطلب حذف حسابك وبياناتك بالكامل.",
              "تلغي اشتراكك في أي وقت من غير أي التزام إضافي.",
            ]}
          />
          <p>
            للتواصل بخصوص أي من الحقوق دي، راسلنا من صفحة{" "}
            <Link to="/contact" className={linkClass}>
              تواصل معنا
            </Link>
            .
          </p>
        </Section>

        <Section title="أمان البيانات">
          <p>
            بنطبّق إجراءات أمان معقولة لحماية بياناتك من الوصول غير المصرح بيه، لكن زي أي خدمة على
            الإنترنت، مفيش ضمان مطلق بنسبة ١٠٠٪.
          </p>
        </Section>

        <Section title="التعديلات على السياسة">
          <p>
            ممكن نحدّث سياسة الخصوصية دي من وقت للتاني. أي تعديل جوهري هنعلن عنه على الموقع مع تاريخ
            التحديث.
          </p>
        </Section>

        <Section title="التواصل معنا">
          <p>
            لو عندك أي سؤال عن سياسة الخصوصية، تقدر تتواصل معانا من خلال صفحة{" "}
            <Link to="/contact" className={linkClass}>
              تواصل معنا
            </Link>
            .
          </p>
        </Section>

        <p className="mt-12 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
          <strong>تنويه:</strong> EGXpert أداة تحليل ومساعدة في اتخاذ القرار الاستثماري، وليست جهة
          استشارية مالية مرخّصة. القرار الاستثماري النهائي ومسؤوليته بالكامل على المستخدم.
        </p>
      </article>
    </SiteShell>
  );
}
