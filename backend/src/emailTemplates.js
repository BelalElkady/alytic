/** Shared HTML shell for every transactional email — inline styles only, as most mail clients strip a <style> block. */
function layout(bodyHtml) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;padding:32px 16px;background:#0f172a;font-family:Tahoma,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 32px;background:#0b1220;">
          <span style="color:#3b82f6;font-size:20px;font-weight:bold;">EGXpert</span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;color:#e2e8f0;font-size:15px;line-height:1.8;text-align:right;">
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
    <p>مبروك${name ? ` يا ${name}` : ''} 🎉</p>
    <p>حسابك في EGXpert اتفعّل بنجاح وتسجيلك خلص. جاهز تبدأ تتابع محفظتك وتحلل أسهم البورصة المصرية.</p>
    <div style="text-align:center;">${button(appUrl, 'روح للمنصة')}</div>
  `);
}
