import nodemailer from 'nodemailer';

/**
 * Sends transactional email over Resend's SMTP relay
 * (https://resend.com/docs/send-with-smtp) rather than their HTTP API, so
 * this is just a standard nodemailer SMTP transport pointed at their server.
 * The account name is always the literal string "resend" — the real secret
 * is the API key used as the SMTP password.
 *
 * With no RESEND_API_KEY (e.g. local dev, or the test suite — see
 * test/helpers/env.js, which blanks it the same way as the AI keys), every
 * send is logged instead of attempted, so nothing here ever needs a real
 * provider to run.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'EGXpert <onboarding@resend.dev>';
const SMTP_HOST = process.env.RESEND_SMTP_HOST ?? 'smtp.resend.com';
const SMTP_PORT = Number(process.env.RESEND_SMTP_PORT ?? 465);

export const emailAvailable = () => Boolean(RESEND_API_KEY);

let transporter = null;
function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: 'resend', pass: RESEND_API_KEY },
  });
  return transporter;
}

/**
 * Fire-and-forget by design: a broken mail provider must never fail
 * registration, login, or a password-reset request — the caller has already
 * done the thing that matters (created the account, issued the token), and
 * the user always has resend-verification / forgot-password to retry
 * delivery. Errors are logged, not thrown.
 */
export async function sendEmail({ to, subject, html }) {
  if (!emailAvailable()) {
    console.log(`[email] (RESEND_API_KEY غير مضبوط) كان هيتبعت لـ ${to}: ${subject}`);
    return;
  }
  try {
    await getTransporter().sendMail({ from: EMAIL_FROM, to, subject, html });
  } catch (err) {
    console.error(`[email] فشل إرسال "${subject}" لـ ${to}:`, err.message);
  }
}
