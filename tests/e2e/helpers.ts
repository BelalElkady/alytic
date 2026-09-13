import { expect, type Page } from "@playwright/test";

export const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

export const PASSWORD = "E2ePassword!123";
export const PHONE = "01012345678";

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
  await page.getByLabel("رقم الموبايل").fill(PHONE);
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

/** The full journey a new user takes: register, then sign in to the desk. */
export async function newDeskUser(page: Page) {
  const email = await registerViaUi(page);
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