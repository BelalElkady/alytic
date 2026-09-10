import { expect, type Page } from "@playwright/test";

export const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

export const PASSWORD = "E2ePassword!123";

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

/** Register a fresh account through the real UI and land on the desk. */
export async function registerViaUi(page: Page, email = uniqueEmail(), name = "مستخدم إي تو إي") {
  await goto(page, "/login?mode=register");
  await page.getByLabel("الاسم").fill(name);
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة السر").fill(PASSWORD);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page).toHaveURL(/\/portfolio/);
  await expect(page.getByText(email)).toBeVisible();
  return email;
}

/** Sign in through the real UI. */
export async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await goto(page, "/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة السر").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/portfolio/);
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
