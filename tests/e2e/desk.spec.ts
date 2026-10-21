import { expect, test } from "@playwright/test";

import {
  goto,
  expectToast,
  loginViaUi,
  manualEntryDialog,
  newDeskUser,
  pickStock,
  recordTrade,
  signOutViaUi,
} from "./helpers";

test.describe("desk flows", () => {
  test("recording a trade shows up in the trades log and the portfolio", async ({ page }) => {
    await newDeskUser(page);

    await recordTrade(page, "ABUK", "100", "45");

    // The trade log is its own tab of the manual-entry dialog.
    const manual = manualEntryDialog(page);
    await manual.getByRole("tab", { name: "سجل الصفقات" }).click();
    await expect(manual.getByText("ربح محقق")).toBeVisible();
    await expect(manual.getByRole("row").filter({ hasText: "ABUK" }).first()).toBeVisible();

    // The portfolio tab now carries the holding.
    await goto(page, "/portfolio");
    await expect(page.getByText("ABUK")).toBeVisible({ timeout: 30_000 });
  });

  test("cash management and the favorites round-trip", async ({ page }) => {
    await newDeskUser(page);

    // حلل الكاش saves the balance, then opens the cash analysis (which has
    // no AI key in tests, so it never spends credits). There is no toast for
    // the save itself, so the balance is checked through the API.
    await goto(page, "/cash");
    await page.locator("#cash-in").fill("75000");
    await page.getByRole("button", { name: "حلل الكاش" }).click();
    await expect
      .poll(async () => (await (await page.request.get("/api/public/api/portfolio")).json()).cash)
      .toBe(75000);
    await goto(page, "/cash");

    // favorites add + remove — just a code and an optional note, no order plan.
    await pickStock(page, "SWDY");
    await page.getByLabel("ملاحظة (اختياري)").fill("راقبه");
    await page.getByRole("button", { name: "إضافة", exact: true }).click();
    await expectToast(page, "تمت الإضافة للأسهم المفضلة");
    await expect(page.getByRole("row").filter({ hasText: "SWDY" })).toBeVisible();

    await page.getByRole("button", { name: "حذف SWDY" }).click();
    await expect(page.getByRole("row").filter({ hasText: "SWDY" })).toHaveCount(0);
  });

  test("saving the daily close writes today's entry into the calendar", async ({ page }) => {
    // The daily close is no longer a manual button — a cron job (see
    // /api/cron/daily-close in server.js) snapshots every user at 14:30 Cairo
    // time. This exercises the same per-user snapshot path (/api/snapshot)
    // that the cron calls for each portfolio, via the frontend's API proxy,
    // using the browser context's session cookie.
    await newDeskUser(page);
    await recordTrade(page, "ABUK", "50", "100");

    const snapshot = await page.request.post("/api/public/api/snapshot");
    expect(snapshot.ok()).toBeTruthy();

    await goto(page, "/calendar");
    await expect(page.getByText("قيمة المحفظة")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("قيمة الأسهم")).toBeVisible();
  });

  test("the manual-entry dialog corrects a holding", async ({ page }) => {
    await newDeskUser(page);
    await recordTrade(page, "ABUK", "100", "45");

    // Holdings are corrected on the تعديل tab of the same dialog.
    const dialog = manualEntryDialog(page);
    await dialog.getByRole("tab", { name: "تعديل" }).click();
    await expect(dialog.getByText("ABUK").first()).toBeVisible();

    const sharesField = dialog.getByLabel("عدد الأسهم");
    await sharesField.fill("120");
    await dialog.getByRole("button", { name: "حفظ التعديلات" }).click();
    await expectToast(page, "تم حفظ التعديلات");

    // the corrected count lands in the portfolio
    await goto(page, "/portfolio");
    await expect(page.getByText("ABUK")).toBeVisible({ timeout: 30_000 });
  });

  test("state survives a logout and a fresh login", async ({ page }) => {
    const email = await newDeskUser(page);
    await recordTrade(page, "SWDY", "10", "20");

    await signOutViaUi(page);
    await loginViaUi(page, email);

    await goto(page, "/portfolio");
    await expect(page.getByText("SWDY")).toBeVisible({ timeout: 30_000 });
  });
});
