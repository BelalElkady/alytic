import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

export const PASSWORD = "E2ePassword!123";
// Fine for forms that are rejected before anything is stored. Anything that
// actually registers needs uniquePhone(): phones are unique per account, and
// the suite shares one real database with parallel workers.
export const PHONE = "01012345678";
export const uniquePhone = () =>
  `01${["0", "1", "2", "5"][Math.floor(Math.random() * 4)]}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

/**
 * The free trial (and so every desk feature) stays locked until the email is
 * confirmed, and the confirmation link only ever goes out by mail — so specs
 * that need the desk mark the row verified straight through Supabase's REST
 * API with the same service-role credentials the backend uses.
 */
async function markEmailVerifiedInDb(email: string) {
  const env: Record<string, string | undefined> = { ...process.env };
  try {
    const envText = fs.readFileSync(path.join(process.cwd(), "backend", ".env"), "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const match = /^\s*(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*)\s*$/.exec(line);
      if (match) env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no backend/.env — the SUPABASE_* env vars must already be set another way */
  }
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are needed to verify e2e users");
  const res = await fetch(`${url}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email_verified: true }),
  });
  if (!res.ok) throw new Error(`could not verify ${email}: ${res.status} ${await res.text()}`);
}

/**
 * Navigate and wait for hydration.
 *
 * The app is server-rendered: the login/portfolio forms exist in the HTML
 * before React attaches their handlers. Acting on the raw HTML submits forms
 * natively (a GET that drops the query string), so every full-page navigation
 * must wait for the client bundle to take over before anything is clicked.
 */
export async function goto(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Register a fresh account through the real UI.
 *
 * Registration never signs anyone in (KNOWN-01): it fills the required phone
 * number and ends on the "تحقق من بريدك الإلكتروني" screen, whatever the email.
 */
export async function registerViaUi(page: Page, email = uniqueEmail(), name = "مستخدم إي تو إي") {
  await goto(page, "/login?mode=register");
  await page.getByLabel("الاسم").fill(name);
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("رقم الموبايل").fill(uniquePhone());
  await page.getByLabel("كلمة السر", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page.getByText("تحقق من بريدك الإلكتروني")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  return email;
}

/**
 * Sign in through the real UI and end up on the desk.
 *
 * A successful sign-in navigates to the marketing home ("/") — the desk
 * itself lives under /portfolio, so the helper hops there and waits for the
 * header to prove the session.
 */
export async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await goto(page, "/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة السر", { exact: true }).fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).toHaveURL(/\/(\?|$)/);
  await goto(page, "/portfolio");
  await expect(page.getByText(email)).toBeVisible();
  return email;
}

/**
 * The full journey a new user takes: register, confirm the email, then sign in
 * to the desk. Pass { verified: false } for the account as it is straight
 * after registering — trial locked behind the "confirm your email" wall.
 */
export async function newDeskUser(page: Page, { verified = true }: { verified?: boolean } = {}) {
  const email = await registerViaUi(page);
  if (verified) await markEmailVerifiedInDb(email);
  await loginViaUi(page, email);
  return email;
}

export async function signOutViaUi(page: Page) {
  await page.getByRole("button", { name: "خروج" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle");
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

/** Pick a stock in a StockPicker combobox by searching its code. */
export async function pickStock(page: Page, code: string) {
  // The desk pages carry more than one combobox (stock picker, buy/sell side),
  // so match the picker by its placeholder or by a code it already shows.
  const trigger = page
    .getByRole("combobox")
    .filter({ hasText: /اختار السهم/ })
    .or(page.getByRole("combobox").filter({ hasText: new RegExp(`\\b${code}\\b`) }))
    .first();
  await trigger.click();
  await page.getByPlaceholder("ابحث بالكود أو الاسم…").fill(code);
  await page.locator("[cmdk-item]").filter({ hasText: code }).first().click();
}

/**
 * Record an executed trade through إدخال يدوي → إدخال صفقة جديدة. Leaves the
 * manual-entry dialog open (the trade popup closes on success).
 */
export async function recordTrade(page: Page, code: string, shares: string, price: string) {
  await goto(page, "/portfolio");
  await page.getByRole("button", { name: "إدخال يدوي" }).click();
  await page.getByRole("button", { name: "إدخال صفقة جديدة" }).click();
  const dialog = page.getByRole("dialog", { name: "إدخال صفقة جديدة" });
  await expect(dialog).toBeVisible();
  await pickStock(page, code);
  await dialog.getByLabel("العدد").fill(shares);
  await dialog.getByLabel("سعر التنفيذ").fill(price);
  await dialog.getByRole("button", { name: "تسجيل الصفقة" }).click();
  await expectToast(page, "تم تسجيل الصفقة وتحديث المحفظة");
  await expect(dialog).toBeHidden();
}