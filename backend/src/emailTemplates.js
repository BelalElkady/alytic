/** Shared HTML shell for every transactional email — inline styles only, as most mail clients strip a <style> block. */
function layout(bodyHtml) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body dir="rtl" style="margin:0;padding:32px 16px;background:#0f172a;font-family:Tahoma,Arial,sans-serif;direction:rtl;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 32px;background:#0b1220;">
          <span style="color:#3b82f6;font-size:20px;font-weight:bold;">EGXpert</span>
        </td>
      </tr>
      <tr>
        <td dir="rtl" style="padding:32px;color:#e2e8f0;font-size:15px;line-height:1.8;text-align:right;direction:rtl;">
          ${bodyHtml}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;">${label}</a>`;
}

/** User-submitted text (contact form) must never inject markup into the sent email. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * " يا <name>" for a greeting, or nothing without a name. Names are often Latin
 * script inside an Arabic sentence, which mail clients reorder unless the name
 * is isolated — U+2068/U+2069 (first-strong isolate) do that as plain text, so
 * it holds even where HTML dir attributes are dropped, and still lets an
 * Arabic name keep its own word order. Escaped: the name is user-supplied.
 */
function addressedTo(name) {
  return name ? ` يا ⁨${escapeHtml(name)}⁩` : '';
}

export function verificationEmailHtml(link) {
  return layout(`
    <p>أهلاً بيك في EGXpert 👋</p>
    <p>اضغط الزرار ده عشان تفعّل بريدك الإلكتروني وتخلّص تسجيل حسابك:</p>
    <div style="text-align:center;">${button(link, 'تفعيل البريد الإلكتروني')}</div>
    <p style="font-size:13px;color:#94a3b8;">الرابط صالح لمدة 24 ساعة. لو الزرار مش شغال، افتح الرابط ده مباشرة:<br>${link}</p>
    <p style="font-size:13px;color:#94a3b8;">لو مسجلتش في EGXpert، تجاهل الإيميل ده.</p>
  `);
}

export function resetPasswordEmailHtml(link) {
  return layout(`
    <p>وصلنا طلب لإعادة تعيين كلمة السر لحسابك في EGXpert.</p>
    <div style="text-align:center;">${button(link, 'إعادة تعيين كلمة السر')}</div>
    <p style="font-size:13px;color:#94a3b8;">الرابط صالح لمدة ساعة واحدة. لو الزرار مش شغال، افتح الرابط ده مباشرة:<br>${link}</p>
    <p style="font-size:13px;color:#94a3b8;">لو منتش أنت اللي طلبت ده، تجاهل الإيميل ده — كلمة السر مش هتتغير.</p>
  `);
}

export function registrationConfirmedEmailHtml(name, appUrl) {
  return layout(`
    <p>مبروك${addressedTo(name)} 🎉</p>
    <p>حسابك في EGXpert اتفعّل بنجاح وتسجيلك خلص. جاهز تبدأ تتابع محفظتك وتحلل أسهم البورصة المصرية.</p>
    <div style="text-align:center;">${button(appUrl, 'روح للمنصة')}</div>
  `);
}

/** Sent to the real account owner when someone tries to register with an email that's already taken — see auth.js's register(). */
export function alreadyRegisteredEmailHtml(name, appUrl) {
  return layout(`
    <p>حد حاول يعمل حساب جديد في EGXpert بإيميلك ده${addressedTo(name)}.</p>
    <p>لو انت اللي عملت المحاولة دي، يبقى عندك حساب بالفعل — سجّل دخولك عادي، أو لو نسيت كلمة السر استخدم "نسيت كلمة السر" من صفحة الدخول.</p>
    <div style="text-align:center;">${button(`${appUrl}/login`, 'تسجيل الدخول')}</div>
    <p style="font-size:13px;color:#94a3b8;">لو مش انت اللي حاول، تجاهل الإيميل ده — حسابك بأمان ومفيش حاجة اتغيرت.</p>
  `);
}

/** Sent to the site's contact address from the public "تواصل معنا" form. */
/**
 * Sent when a user writes into the in-app support chat. Replying by email
 * would be invisible to them — the conversation lives in the app — so this
 * points at the admin panel instead of inviting a reply-to.
 */
export function supportMessageEmailHtml({ name, email, message, appUrl }) {
  return layout(`
    <p>رسالة جديدة في الشات من مستخدم EGXpert:</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#94a3b8;width:80px;">الاسم</td><td>${escapeHtml(name || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#94a3b8;">البريد</td><td dir="ltr" style="text-align:right;">${escapeHtml(email)}</td></tr>
    </table>
    <p style="white-space:pre-wrap;background:#0b1220;padding:16px;border-radius:8px;">${escapeHtml(message)}</p>
    <p style="font-size:13px;color:#94a3b8;">
      رُد عليها من لوحة الإدارة → الدعم${appUrl ? `: <a href="${escapeHtml(appUrl)}/admin" style="color:#60a5fa;">${escapeHtml(appUrl)}/admin</a>` : ''}
    </p>
  `);
}

export function contactEmailHtml({ name, email, message }) {
  return layout(`
    <p>رسالة جديدة من نموذج "تواصل معنا" في EGXpert:</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#94a3b8;width:80px;">الاسم</td><td>${escapeHtml(name)}</td></tr>
      <tr><td style="padding:4px 0;color:#94a3b8;">البريد</td><td dir="ltr" style="text-align:right;">${escapeHtml(email)}</td></tr>
    </table>
    <p style="white-space:pre-wrap;background:#0b1220;padding:16px;border-radius:8px;">${escapeHtml(message)}</p>
    <p style="font-size:13px;color:#94a3b8;">رد عليها مباشرة على ${escapeHtml(email)}.</p>
  `);
}
