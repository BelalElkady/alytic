import { expect, test } from "@playwright/test";

import { goto, PASSWORD, loginViaUi, registerViaUi, signOutViaUi, uniqueEmail } from "./helpers";

test.describe("authentication", () => {
  test("an unauthenticated desk bounces to the login screen", async ({ page }) => {
    await goto(page, "/portfolio");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("registering opens the desk, and signing out returns to login", async ({ page }) => {
    const email = await registerViaUi(page);
    await signOutViaUi(page);
    // the same account can log back in
    await loginViaUi(page, email);
    await expect(page.getByText(email)).toBeVisible();
  });

  test("a wrong password shows the engine's Arabic error", async ({ page }) => {
    const email = await registerViaUi(page);
    await signOutViaUi(page);
    await goto(page, "/login");
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة السر").fill("WrongPassword!123");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page.getByRole("alert")).toContainText("البريد الإلكتروني أو كلمة المرور غير صحيحة");
  });

  test("registering an already-registered email reports the conflict", async ({ page }) => {
    const email = await registerViaUi(page);
    await signOutViaUi(page);
    await goto(page, "/login?mode=register");
    await page.getByLabel("الاسم").fill("مكرر");
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة السر").fill(PASSWORD);
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    await expect(page.getByRole("alert")).toContainText("البريد الإلكتروني مسجل بالفعل");
  });

  test("a too-short password is rejected with the engine's Arabic message", async ({ page }) => {
    await goto(page, "/login?mode=register");
    await page.getByLabel("الاسم").fill("قصير");
    await page.getByLabel("البريد الإلكتروني").fill(uniqueEmail());
    await page.getByLabel("كلمة السر").fill("short");
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    // The input has no minlength, so the request reaches the engine, which refuses.
    await expect(page).toHaveURL(/mode=register/);
    await expect(page.getByRole("alert")).toContainText("8 حروف على الأقل");
  });
});
