import { expect, test } from "@playwright/test";

import { goto } from "./helpers";

test.describe("marketing site", () => {
  test("the landing page sells the product", async ({ page }) => {
    await goto(page, "/");
    await expect(page).toHaveTitle(/EGXpert/);
    await expect(page.getByRole("heading", { name: "خبير البورصة المصرية في جيبك" })).toBeVisible();
    await expect(page.getByRole("link", { name: "ابدأ التجربة المجانية" })).toBeVisible();

    // the advertised features actually exist
    await expect(page.getByText("محفظة واضحة في شاشة واحدة")).toBeVisible();
    await expect(page.getByText("وقف خسارة وأهداف محسوبة")).toBeVisible();
    await expect(page.getByText("توصيات تتغيّر مع سلوكك")).toBeVisible();
  });

  test("the free-trial CTA leads to registration", async ({ page }) => {
    await goto(page, "/");
    await page.getByRole("link", { name: "ابدأ التجربة المجانية" }).click();
    await expect(page).toHaveURL(/\/login\?mode=register/);
    await expect(page.getByRole("heading", { name: "إنشاء حساب جديد" })).toBeVisible();
    await expect(page.getByLabel("الاسم")).toBeVisible();
  });

  test("the pricing page renders", async ({ page }) => {
    await goto(page, "/pricing");
    await expect(page.getByRole("heading", { name: "أسعار بسيطة وواضحة" })).toBeVisible();
  });
});
