import dotenv from "dotenv";
import { chromium, type Page } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, "../../.env") });

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";

function requiredEnvironmentValue(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const username = requiredEnvironmentValue("ADMIN_USERNAME");
const password = requiredEnvironmentValue("ADMIN_PASSWORD");
const services = [
  { id: "netflix", label: "Netflix", pin: requiredEnvironmentValue("BOT_NEW_PIN"), pinLength: 4 },
  { id: "prime", label: "Prime", pin: requiredEnvironmentValue("BOT_PRIME_PIN"), pinLength: 5 },
  { id: "hbo", label: "HBO", pin: requiredEnvironmentValue("BOT_HBO_PIN"), pinLength: 4 },
  { id: "disney", label: "Disney", pin: requiredEnvironmentValue("BOT_DISNEY_PIN"), pinLength: 4 }
];

for (const service of services) {
  if (!new RegExp(`^\\d{${service.pinLength}}$`).test(service.pin)) {
    throw new Error(`BOT PIN for ${service.label} must contain exactly ${service.pinLength} digits`);
  }
}

async function waitForExpiryStatus(page: Page, expected: string): Promise<void> {
  await page.waitForFunction(
    (expectedStatus) =>
      document.querySelector("#expiry-status")?.textContent?.includes(expectedStatus),
    expected
  );
}

async function runBot(page: Page): Promise<void> {
  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) {
    throw new Error(`Demo website is unavailable at ${baseUrl}`);
  }

  await page.getByLabel("Admin Username").fill(username);
  await page.getByLabel("Admin Password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.getByRole("heading", { name: "Admin Control" }).waitFor();

  const runId = Date.now().toString();
  for (const service of services) {
    const email = `demo.${service.id}.${runId}@example.test`;
    const alias = `Bot ${service.label} ${runId}`;
    await page.getByRole("button", { name: "Bind Account" }).click();
    await page.getByLabel("บริการ", { exact: true }).selectOption(service.id);
    await page.locator("#bind-alias").fill(alias);
    await page.getByLabel("อีเมลบัญชี (จำลอง)").fill(email);
    await page
      .getByLabel("รหัสผ่านเดโม (ไม่ส่งหรือบันทึก)")
      .fill("demo-only-placeholder");
    await page
      .getByRole("button", { name: "ขอ OTP เพื่อเข้าบริการสตรีมมิ่ง" })
      .click();
    await page.getByText("บอทเข้าสู่บริการจำลองสำเร็จ").waitFor();
    const displayedOtp = await page.locator("#mock-otp-code").innerText();
    if (!/\d{6}/.test(displayedOtp)) {
      throw new Error(`Mock email OTP was not displayed for ${service.label}`);
    }
    await page.getByRole("button", { name: "ยืนยัน Bind Account" }).click();
    await page.locator("#account-title").waitFor();
    await page.waitForFunction(
      (expectedAlias) =>
        document.querySelector("#account-title")?.textContent?.includes(expectedAlias),
      alias
    );
    if (!(await page.locator("#account-title").innerText()).includes(alias)) {
      throw new Error(`${service.label} bound account was not selected`);
    }
    await page.getByRole("button", { name: alias, exact: true }).waitFor();

    await page.getByTestId("profile-3").click();
    const profileName = service.id === "netflix" ? "Bot Test Profile 3" : "Profile 3";
    if (service.id === "netflix") {
      await page.getByLabel("ชื่อโปรไฟล์").fill(profileName);
      await page.getByRole("button", { name: "บันทึกชื่อโปรไฟล์" }).click();
      await page.getByRole("heading", { name: profileName }).waitFor();
    }

    await page.getByRole("button", { name: "สุ่ม PIN" }).click();
    await page.waitForFunction((length) => {
      const input = document.querySelector("#new-pin");
      return (
        input instanceof HTMLInputElement &&
        new RegExp(`^\\d{${length}}$`).test(input.value)
      );
    }, service.pinLength);
    const randomPin = await page.getByLabel("New PIN").inputValue();
    if (!new RegExp(`^\\d{${service.pinLength}}$`).test(randomPin)) {
      const randomPinMessage = await page.locator("#message").innerText();
      throw new Error(
        `Random ${service.label} PIN has an invalid length: ${randomPin}; ${randomPinMessage}`
      );
    }

    await page.getByLabel("New PIN").fill(service.pin);
    await page.getByRole("button", { name: "เปลี่ยน PIN", exact: true }).click();
    const expectedMessage =
      `PIN ของ Profile 3 (${service.label}) เปลี่ยนแล้ว และนำโปรไฟล์ออกจากระบบจำลอง`;
    await page.waitForFunction((expected) => {
      const result = document.querySelector("#message");
      return (
        result?.textContent?.includes(expected) ||
        result?.classList.contains("error")
      );
    }, expectedMessage);

    const actualMessage = await page.locator("#message").innerText();
    if (actualMessage !== expectedMessage) {
      throw new Error(`${service.label} PIN update failed: ${actualMessage}`);
    }

    const displayedPin = await page.getByTestId("profile-3-pin").innerText();
    if (displayedPin !== `PIN: ${service.pin}`) {
      throw new Error(`${service.label} displayed PIN did not match: ${displayedPin}`);
    }
    if (
      !(await page.getByTestId("expiry-status").innerText()).includes("ถูกนำออกแล้ว")
    ) {
      throw new Error(`${service.label} profile was not marked as removed after PIN change`);
    }

    if (service.id === "netflix") {
      const customDate = new Date();
      customDate.setDate(customDate.getDate() + 14);
      const dateValue = [
        String(customDate.getDate()).padStart(2, "0"),
        String(customDate.getMonth() + 1).padStart(2, "0"),
        customDate.getFullYear()
      ].join("/");
      await page.locator("#expiry-date").fill(dateValue);
      await page.getByRole("button", { name: "กำหนดวัน", exact: true }).click();
      await waitForExpiryStatus(page, "ใช้งานอยู่");
      if (!(await page.getByTestId("expiry-status").innerText()).includes("ใช้งานอยู่")) {
        throw new Error("Custom DD/MM/YYYY expiry date was not accepted");
      }
      if ((await page.locator("#expiry-date").inputValue()) !== dateValue) {
        throw new Error("Custom expiry date was not displayed as DD/MM/YYYY");
      }
    }

    await page.locator('[data-expiry-duration="week"]').click();
    await waitForExpiryStatus(page, "เหลืออีก 7 วัน");
    if (
      !(await page.getByTestId("expiry-status").innerText()).includes("เหลืออีก 7 วัน")
    ) {
      throw new Error(`${service.label} weekly expiry was not assigned correctly`);
    }
    await page.getByRole("button", { name: "เคลียร์วันหมดอายุ / ทำให้โปรไฟล์ว่าง" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#expiry-status")?.textContent === "สถานะ: ว่าง"
    );
    if ((await page.getByTestId("expiry-status").innerText()) !== "สถานะ: ว่าง") {
      throw new Error(`${service.label} expiry clear did not mark the profile vacant`);
    }
    const pinAfterClear = await page.getByTestId("profile-3-pin").innerText();
    if (pinAfterClear === `PIN: ${service.pin}`) {
      throw new Error(`${service.label} PIN was not rotated when clearing expiry`);
    }
  }

  await page.getByLabel("ค้นหาชื่อบัญชี").fill(`Bot Prime ${runId}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("heading", { name: "Prime", exact: true }).waitFor();
  if (
    await page
      .getByRole("button", { name: `Bot Netflix ${runId}`, exact: true })
      .count()
  ) {
    throw new Error("Alias search did not filter unrelated accounts");
  }

  await page.getByRole("button", { name: "ล้างการค้นหา" }).click();
  for (const service of services) {
    await page
      .getByRole("button", { name: `Bot ${service.label} ${runId}`, exact: true })
      .waitFor();
  }

  await page.getByRole("button", { name: "ค้นหาโปรไฟล์ว่าง" }).click();
  await page.getByLabel("เลือกบริการ").selectOption("prime");
  await page.getByRole("button", { name: "ค้นหาโปรไฟล์ว่าง" }).last().click();
  await page.getByRole("heading", { name: `Bot Prime ${runId} · PR-002` }).waitFor();
  await page.getByRole("button", { name: "Profile 3 · ว่าง", exact: true }).waitFor();

  await page.getByLabel("ค้นหาชื่อบัญชี").fill(`Bot Prime ${runId}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Admin Control" }).waitFor();
  if ((await page.getByLabel("ค้นหาชื่อบัญชี").inputValue()) !== "") {
    throw new Error("Account search filter was not cleared after refresh");
  }
  for (const service of services) {
    await page
      .getByRole("button", { name: `Bot ${service.label} ${runId}`, exact: true })
      .waitFor();
  }

  console.log("PASS: Binding, PIN expiry/rotation, vacant search, alias search, clear, and refresh verified.");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await runBot(page);
} finally {
  await browser.close();
}
