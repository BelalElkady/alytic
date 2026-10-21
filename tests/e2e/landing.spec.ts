import { expect, test, type Page } from "@playwright/test";

import { PLANS } from "../../backend/src/billing/plans.js";
import { goto } from "./helpers";

// The hero is the section holding the page's only h1. Its two calls to
// action also appear elsewhere (the promo banner, the pricing cards), so
// they are always looked up inside it.
const hero = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { level: 1 }) });

// What the pricing cards print, the same way: Latin digits, comma thousands.
const egp = (value: number) => value.toLocaleString("en-US");

test.describe("marketing site", () => {
  test("the landing page sells the product", async ({ page }) => {
    await goto(page, "/");
    await expect(page).toHaveTitle(/EGXpert/);
    await expect(page.getByRole("heading", { level: 1, name: "خبير البورصة المصرية في جيبك" })).toBeVisible();
    await expect(hero(page).getByText("تجربة مجانية ٥ أيام تداول — بدون بطاقة")).toBeVisible();
    await expect(hero(page).getByRole("link", { name: "ابدأ التجربة المجانية" })).toBeVisible();

    // the advertised features actually exist
    for (const feature of ["محفظة واضحة في شاشة واحدة", "وقف خسارة وأهداف محسوبة", "توصيات تتغيّر مع سلوكك"]) {
      await expect(page.getByRole("heading", { name: feature })).toBeVisible();
    }
  });

  test("the trial CTA opens registration and the prices CTA opens the pricing page", async ({ page }) => {
    await goto(page, "/");
    await hero(page).getByRole("link", { name: "ابدأ التجربة المجانية" }).click();
    await expect(page).toHaveURL(/\/login/);

    await goto(page, "/");
    await hero(page).getByRole("link", { name: "شوف الأسعار" }).click();
    await expect(page).toHaveURL(/\/pricing/);
  });

  // Prices come from backend/src/billing/plans.js, the list the subscription
  // is actually sold at, so a change there that the cards miss fails here.
  test("the pricing page shows the free trial and both paid tiers at their real prices", async ({ page }) => {
    await goto(page, "/pricing");
    await expect(page.getByRole("heading", { level: 1, name: "أسعار واضحة لكل مستوى" })).toBeVisible();

    const card = (name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name }) });
    await expect(card("الباقة المجانية").getByText("مجانًا", { exact: true })).toBeVisible();
    await expect(card("الباقة المجانية").getByText("لمدة 5 أيام تداول")).toBeVisible();

    const paid = [
      { name: "باقة النفس الطويل", monthly: PLANS.long_monthly.priceEgp, yearly: PLANS.long_yearly.priceEgp },
      { name: "باقة الحريفة", monthly: PLANS.trader_monthly.priceEgp, yearly: PLANS.trader_yearly.priceEgp },
    ];

    // Yearly is the default tab: a per-month figure, the one-time total and the saving.
    for (const tier of paid) {
      const c = card(tier.name);
      await expect(c.getByText(egp(Math.round(tier.yearly / 12)), { exact: true })).toBeVisible();
      await expect(c.getByText(`بتدفع ${egp(tier.yearly)} جنيه مرة واحدة في السنة`)).toBeVisible();
      await expect(c.getByText(`هتوفّر ${egp(tier.monthly * 12 - tier.yearly)} جنيه في السنة`)).toBeVisible();
    }

    await page.getByRole("tab", { name: "شهري" }).click();
    for (const tier of paid) {
      await expect(card(tier.name).getByText(egp(tier.monthly), { exact: true })).toBeVisible();
    }
  });
});
