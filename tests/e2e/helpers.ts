import { expect, type Page } from "@playwright/test";
import { resolveTestDatabase, testRunId } from "../../backend/test/helpers/test-database.js";

// Carries the run tag (TEST_RUN_ID, set in playwright.config.ts) so teardown only deletes this run's accounts.
export const uniqueEmail = () => `e2e-${testRunId()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

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
  // The same test project the E2E backend runs against, never production.
  const { url, key } = resolveTestDatabase();
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
 * desk to prove the session: the header's sign-out button, or, for a new
 * confirmed account, the mandatory style dialog (a modal, so it hides the
 * header from the accessibility tree until it is answered). Not the email:
 * the header shows the account's name when it has one, and an unconfirmed
 * account's banners repeat the email, so it is neither present nor unique.
 */
export async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await goto(page, "/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة السر", { exact: true }).fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).toHaveURL(/\/(\?|$)/);
  await skipWelcomeTour(page);
  await goto(page, "/portfolio");
  await expect(page).toHaveURL(/\/portfolio/);
  await expect(page.getByRole("button", { name: "خروج" }).or(page.getByRole("alertdialog"))).toBeVisible();
  return email;
}

/**
 * Answer the mandatory "اختار سلوكك الاستثماري" dialog a new account meets on
 * its first visit to the desk. It blocks everything behind it, so any spec
 * that wants to use the desk has to get past it.
 */
export async function chooseInvestStyleViaUi(page: Page, label = "متوسط المدى") {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("اختار سلوكك الاستثماري")).toBeVisible();
  await dialog.getByRole("radio", { name: new RegExp(label) }).click();
  await dialog.getByRole("button", { name: "حفظ ومتابعة" }).click();
  await expect(dialog).toBeHidden();
}

/**
 * The full journey a new user takes: register, confirm the email, sign in to
 * the desk and pick an investment style. Pass { verified: false } for the
 * account as it is straight after registering — trial locked behind the
 * "confirm your email" wall (no style dialog there), or { chooseStyle: false }
 * to stop with the style dialog still open.
 */
export async function newDeskUser(
  page: Page,
  { verified = true, chooseStyle = true }: { verified?: boolean; chooseStyle?: boolean } = {},
) {
  const email = await registerViaUi(page);
  if (verified) await markEmailVerifiedInDb(email);
  await loginViaUi(page, email);
  if (verified && chooseStyle) await chooseInvestStyleViaUi(page);
  return email;
}

export async function signOutViaUi(page: Page) {
  await page.getByRole("button", { name: "خروج" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle");
}

export async function expectToast(page: Page, text: string | RegExp, timeout?: number) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible({ timeout });
}

/**
 * Marks the welcome tour as seen for the signed-in account, the way closing
 * it does (MainTour in frontend/src/components/tour/main-tour.tsx). Left to
 * itself it opens over /portfolio at a moment that depends on timing and
 * swallows whatever click lands then. Must run before /portfolio loads: the
 * tour reads this key once, when it arms its timer.
 */
async function skipWelcomeTour(page: Page) {
  const me = await (await page.request.get("/api/public/api/auth/me")).json();
  const id = me?.user?.id;
  if (id) await page.evaluate((key) => localStorage.setItem(key, new Date().toISOString()), `alytic-tour-main-seen:${id}`);
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

/** The إدخال يدوي dialog: tabs تعديل (correct holdings), صفقة جديدة, سجل الصفقات. */
export const manualEntryDialog = (page: Page) => page.getByRole("dialog", { name: "إدخال يدوي" });

/**
 * Record an executed trade through إدخال يدوي → the صفقة جديدة tab. Leaves the
 * manual-entry dialog open on that tab (the form resets after a trade).
 */
export async function recordTrade(page: Page, code: string, shares: string, price: string) {
  await goto(page, "/portfolio");
  await page.getByRole("button", { name: "إدخال يدوي" }).click();
  const dialog = manualEntryDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "صفقة جديدة" }).click();
  await pickStock(page, code);
  await dialog.getByLabel("العدد").fill(shares);
  await dialog.getByLabel("سعر التنفيذ").fill(price);
  await dialog.getByRole("button", { name: "تسجيل الصفقة" }).click();
  // The toast only shows once the whole desk has reloaded, which in CI (price
  // feeds unreachable) takes well past the default 15 s.
  await expectToast(page, "تم تسجيل الصفقة وتحديث المحفظة", 60_000);
}