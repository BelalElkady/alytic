import { expect, test } from "@playwright/test";

import {
  PASSWORD, PHONE, chooseInvestStyleViaUi, goto, loginViaUi, newDeskUser, registerViaUi,
  signOutViaUi, uniqueEmail,
} from "./helpers";

test.describe("authentication", () => {
  test("an unauthenticated desk bounces to the login screen", async ({ page }) => {
    for (const path of ["/portfolio", "/settings", "/admin"]) {
      await goto(page, path);
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    }
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("registering ends on the check-your-email screen, not in the desk", async ({ page }) => {
    const email = await registerViaUi(page);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("تحقق من بريدك الإلكتروني")).toBeVisible();
    // Not signed in — no header identity anywhere on this screen.
    await expect(page.getByText(email)).toHaveCount(0);

    // "العودة لتسجيل الدخول" swaps back to the login form.
    await page.getByRole("button", { name: "العودة لتسجيل الدخول" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("registering an already-registered email shows the identical screen", async ({ page }) => {
    const email = await registerViaUi(page);
    await goto(page, "/login?mode=register");
    await page.getByLabel("الاسم").fill("مكرر");
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("رقم الموبايل").fill(PHONE);
    await page.getByLabel("كلمة السر", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    // Same screen, and definitely no error leaking that the address exists.
    await expect(page.getByText("تحقق من بريدك الإلكتروني")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("a too-short password is rejected with the engine's Arabic message", async ({ page }) => {
    await goto(page, "/login?mode=register");
    await page.getByLabel("الاسم").fill("قصير");
    await page.getByLabel("البريد الإلكتروني").fill(uniqueEmail());
    await page.getByLabel("رقم الموبايل").fill(PHONE);
    await page.getByLabel("كلمة السر", { exact: true }).fill("short");
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    await expect(page.getByRole("alert")).toContainText("8 حروف على الأقل");
    await expect(page.getByText("تحقق من بريدك الإلكتروني")).toHaveCount(0);
  });

  test("an invalid phone is refused; a valid one passes", async ({ page }) => {
    await goto(page, "/login?mode=register");
    await page.getByLabel("الاسم").fill("بدون تليفون");
    await page.getByLabel("البريد الإلكتروني").fill(uniqueEmail());
    await page.getByLabel("رقم الموبايل").fill("12345");
    await page.getByLabel("كلمة السر", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    await expect(page.getByRole("alert")).toContainText("رقم موبايل صحيح");
    await expect(page.getByText("تحقق من بريدك الإلكتروني")).toHaveCount(0);
  });

  test("a wrong password and an unknown email fail with the same message", async ({ page }) => {
    const email = await registerViaUi(page);

    for (const attempt of [{ email, password: "WrongPass!99" }, { email: "ghost@nowhere.dev", password: PASSWORD }]) {
      await goto(page, "/login");
      await page.getByLabel("البريد الإلكتروني").fill(attempt.email);
      await page.getByLabel("كلمة السر", { exact: true }).fill(attempt.password);
      await page.getByRole("button", { name: "دخول", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("signing in reaches the desk, and signing out ends the session", async ({ page }) => {
    const email = await newDeskUser(page);
    await expect(page.getByText(email)).toBeVisible();

    await signOutViaUi(page);
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();

    // The desk stays closed for the signed-out browser.
    await goto(page, "/portfolio");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unconfirmed email sees the confirm-your-email wall instead of the desk", async ({ page }) => {
    await newDeskUser(page, { verified: false });
    await expect(page.getByRole("heading", { name: "فعّل بريدك عشان تبدأ التجربة" })).toBeVisible();
    // The trial is running but not usable, so it must not read as "trial ended".
    await expect(page.getByText("خلصت التجربة المجانية")).toHaveCount(0);
  });

  test("a new account must pick an investment style before using the desk", async ({ page }) => {
    await newDeskUser(page, { chooseStyle: false });
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("اختار سلوكك الاستثماري")).toBeVisible();

    // Nothing is preselected, so saving is impossible until a card is picked...
    await expect(dialog.getByRole("button", { name: "حفظ ومتابعة" })).toBeDisabled();
    // ...and the dialog can't be dismissed around the choice.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    await chooseInvestStyleViaUi(page, "مضارب");

    // The pick is saved on the account, so it is not asked for again.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("سلوكك الاستثماري: مضارب")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("/login bounces an already signed-in user back to the home page", async ({ page }) => {
    await newDeskUser(page);
    await goto(page, "/login");
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toHaveCount(0);
  });

  test("the login/register toggle swaps the forms and clears errors", async ({ page }) => {
    await goto(page, "/login");
    // Trigger an error first so we can watch it get cleared.
    await page.getByLabel("البريد الإلكتروني").fill("ghost@nowhere.dev");
    await page.getByLabel("كلمة السر", { exact: true }).fill("WrongPass!99");
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByRole("button", { name: "إنشاء حساب", exact: true }).click();
    await expect(page.getByRole("heading", { name: "إنشاء حساب جديد" })).toBeVisible();
    await expect(page.getByLabel("الاسم")).toBeVisible();
    await expect(page.getByLabel("رقم الموبايل")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.getByLabel("الاسم")).toHaveCount(0);
    await expect(page.getByLabel("رقم الموبايل")).toHaveCount(0);
  });

  test("the password visibility toggle reveals and hides the value", async ({ page }) => {
    await goto(page, "/login");
    const field = page.getByLabel("كلمة السر", { exact: true });
    await field.fill("Secret!123");
    await expect(field).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "إظهار كلمة السر" }).click();
    await expect(field).toHaveAttribute("type", "text");
    await expect(field).toHaveValue("Secret!123");

    await page.getByRole("button", { name: "إخفاء كلمة السر" }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("فضّلني مسجّل دخول controls whether the cookie outlives the browser", async ({ page }) => {
    const email = await registerViaUi(page);

    // remember=true (default): the cookie carries an expiry date.
    await loginViaUi(page, email);
    let session = (await page.context().cookies()).find((c) => c.name === "alytic_session");
    expect(session?.expires ?? -1).toBeGreaterThan(Date.now() / 1000);
    await signOutViaUi(page);

    // remember=false: a browser-session cookie — no expiry timestamp at all.
    await goto(page, "/login");
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة السر", { exact: true }).fill(PASSWORD);
    await page.getByRole("checkbox").click(); // untick فضّلني مسجّل دخول
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await expect(page).toHaveURL(/\/(\?|$)/);
    session = (await page.context().cookies()).find((c) => c.name === "alytic_session");
    expect(session?.expires).toBe(-1);
  });

  test("forgot-password answers identically for known and unknown emails", async ({ page }) => {
    const known = await registerViaUi(page);
    for (const email of [known, "ghost@nowhere.dev"]) {
      await goto(page, "/forgot-password");
      await page.getByLabel("البريد الإلكتروني").fill(email);
      await page.getByRole("button", { name: "إرسال رابط إعادة التعيين" }).click();
      await expect(page.getByText("تحقق من بريدك الإلكتروني")).toBeVisible();
    }
  });
});
