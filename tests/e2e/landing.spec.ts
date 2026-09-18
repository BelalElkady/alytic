import { expect, test } from "@playwright/test";

import { goto } from "./helpers";

test.describe("marketing site", () => {
  test("the landing page sells the product", async ({ page }) => {
    await goto(page, "/");
    await expect(page).toHaveTitle(/EGXpert/);
    await expect(page.getByRole("heading", { name: "خبير البورصة المصرية في جيبك" })).toBeVisible();
    await expect(page.getByText("تجربة مجانية ٥ أيام تداول — بدون بطاقة")).toBeVisible();
    await expect(page.getByRole("link", { name: "ابدأ التجربة المجانية" })).toBeVisible();

    // the advertised features actually exist
    await expect(page.getByText("محفظة واضحة في شاشة واحدة")).toBeVisible();
    await expect(page.getByText("وقف خسارة وأهداف محسوبة")).toBeVisible();
    await expect(page.getByText("توصيات تتغيّر مع سلوكك")).toBeVisible();
  });

  test("the trial CTA opens registration and the prices CTA opens the pricing page", async ({ page }) => {
    await goto(page, "/");
    await expect(page.getByText("لمدة 5 أيام تداول")).toBeVisible();
    await page.getByRole("link", { name: "ابدأ التجربة المجانية" }).click();
    await expect(page).toHaveURL(/\/login/);

    await goto(page, "/");
    await page.getByRole("link", { name: "شوف الأسعار" }).click();
    await expect(page).toHaveURL(/\/pricing/);
  });

  test("the pricing page shows the trial and both paid plans", async ({ page }) => {
    await goto(page, "/pricing");
    await expect(page.getByRole("heading", { name: "أسعار بسيطة وواضحة" })).toBeVisible();

    // Three plans with the exact figures the chat bot quotes too.
    await expect(page.getByText("تجربة مجانية", { exact: true })).toBeVisible();
    await expect(page.getByText("لمدة ٥ أيام تداول")).toBeVisible();
    await expect(page.getByText("١٤٩", { exact: true })).toBeVisible();
    await expect(page.getByText("١٥٩٩", { exact: true })).toBeVisible();
    await expect(page.getByText("بتوفّر ١٨٩ جنيه مقارنة بالشهري.")).toBeVisible();
  });
});
