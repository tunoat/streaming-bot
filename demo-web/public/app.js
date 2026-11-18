const loginPanel = document.querySelector("#login-panel");
const accountPanel = document.querySelector("#account-panel");
const serviceControls = document.querySelector("#service-controls");
const profileList = document.querySelector("#profile-list");
const profileDetail = document.querySelector("#profile-detail");
const accountTitle = document.querySelector("#account-title");
const accountNameForm = document.querySelector("#account-name-form");
const accountNameInput = document.querySelector("#account-name");
const profileTitle = document.querySelector("#profile-title");
const profileNameInput = document.querySelector("#profile-name");
const currentPin = document.querySelector("#current-pin");
const pinStatus = document.querySelector("#pin-status");
const expiryStatus = document.querySelector("#expiry-status");
const expiryDateInput = document.querySelector("#expiry-date");
const newPinInput = document.querySelector("#new-pin");
const pinHint = document.querySelector("#pin-hint");
const message = document.querySelector("#message");
const boundAccountList = document.querySelector("#bound-account-list");
const bindDialog = document.querySelector("#bind-dialog");
const bindStartForm = document.querySelector("#bind-start-form");
const bindOtpStep = document.querySelector("#bind-otp-step");
const bindMessage = document.querySelector("#bind-message");
const loginStatus = document.querySelector("#streaming-login-status");
const mockOtpCode = document.querySelector("#mock-otp-code");
const confirmBindButton = document.querySelector("#confirm-bind-button");
const adminAssistNote = document.querySelector("#admin-assist-note");
const vacantProfileDialog = document.querySelector("#vacant-profile-dialog");
const vacantProfileResults = document.querySelector("#vacant-profile-results");
let services = [];
let profiles = [];
let boundAccounts = [];
let selectedServiceId = null;
let selectedProfileId = null;
let selectedBoundAccount = null;
let pendingBindingChallengeId = null;
let accountSearchTerm = "";

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || "คำขอไม่สำเร็จ");
  }
  return body;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function getSelectedService() {
  return services.find((service) => service.id === selectedServiceId);
}

function selectedProfilesUrl() {
  const accountQuery = selectedBoundAccount
    ? `?accountId=${encodeURIComponent(selectedBoundAccount.id)}`
    : "";
  return `/api/services/${selectedServiceId}/profiles${accountQuery}`;
}

function selectedProfileActionUrl(profileId, action) {
  const accountQuery = selectedBoundAccount
    ? `?accountId=${encodeURIComponent(selectedBoundAccount.id)}`
    : "";
  return `/api/services/${selectedServiceId}/profiles/${profileId}/${action}${accountQuery}`;
}

function formatExpiryInput(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function parseExpiryInput(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    throw new Error("กรอกวันหมดอายุในรูปแบบ วัน/เดือน/ปี เช่น 25/12/2026");
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year >= 2400 && year < 3000) {
    year -= 543;
  }

  const date = new Date(year, month - 1, day, 23, 59, 59);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("วันหมดอายุไม่ถูกต้อง");
  }
  return date;
}

function getExpirySummary(profile) {
  if (profile.expiryStatus === "expired") {
    return "หมดอายุแล้ว";
  }
  if (profile.expiryStatus === "revoked") {
    return "ถูกนำออกแล้ว";
  }
  if (profile.expiryStatus === "vacant") {
    return "ว่าง";
  }
  return `เหลืออีก ${profile.daysRemaining} วัน`;
}

function renderProfiles() {
  profileList.replaceChildren();
  for (const profile of profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-card";
    button.dataset.testid = `profile-${profile.id}`;
    button.setAttribute("aria-pressed", String(selectedProfileId === profile.id));

    const name = document.createElement("strong");
    name.textContent = profile.name;
    const pin = document.createElement("span");
    pin.dataset.testid = `profile-${profile.id}-pin`;
    pin.textContent = `PIN: ${profile.currentPin}`;
    const status = document.createElement("span");
    status.dataset.testid = `profile-${profile.id}-status`;
    status.textContent = profile.pinChangedAt ? "PIN เปลี่ยนแล้ว" : "ยังไม่เคยเปลี่ยน PIN";
    const expiry = document.createElement("span");
    expiry.dataset.testid = `profile-${profile.id}-expiry`;
    expiry.textContent = getExpirySummary(profile);
    button.append(name, pin, status, expiry);
    button.addEventListener("click", () => selectProfile(profile.id));
    profileList.append(button);
  }
}

async function selectService(serviceId, boundAccount = null) {
  const service = services.find((item) => item.id === serviceId);
  if (!service) {
    throw new Error(`ไม่พบบริการ ${serviceId}`);
  }

  selectedServiceId = serviceId;
  selectedBoundAccount = boundAccount;
  selectedProfileId = null;
  profiles = [];
  profileList.replaceChildren();
  serviceControls.classList.remove("hidden");
  profileDetail.classList.add("hidden");
  profileList.classList.add("hidden");
  accountNameForm.classList.remove("hidden");
  const accountName = boundAccount?.alias ?? service.accountName;
  accountTitle.textContent = `${service.label} · ${boundAccount?.accountId ?? service.accountId} · ${accountName}`;
  accountNameInput.value = accountName;
  showMessage("");

  try {
    profiles = await request(selectedProfilesUrl());
    profileList.classList.remove("hidden");
    renderProfiles();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function loadServices() {
  services = await request("/api/services");
}

async function loadBoundAccounts() {
  boundAccounts = await request("/api/bindings");
  renderBoundAccounts();
}

function renderBoundAccounts() {
  boundAccountList.replaceChildren();
  if (boundAccounts.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "muted";
    emptyMessage.textContent = "ยังไม่มีบัญชีที่ Bind เพิ่ม";
    boundAccountList.append(emptyMessage);
    return;
  }

  const matchingAccounts = boundAccounts.filter((account) =>
    account.alias.toLocaleLowerCase().includes(accountSearchTerm.toLocaleLowerCase())
  );
  if (matchingAccounts.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "muted";
    emptyMessage.textContent = "ไม่พบบัญชีที่ตรงกับคำค้น";
    boundAccountList.append(emptyMessage);
    return;
  }

  for (const service of services) {
    const serviceAccounts = matchingAccounts.filter(
      (account) => account.serviceId === service.id
    );
    if (serviceAccounts.length === 0) {
      continue;
    }

    const group = document.createElement("section");
    group.className = "account-group";
    const heading = document.createElement("h4");
    heading.textContent = service.label;
    const accountGrid = document.createElement("div");
    accountGrid.className = "account-group-items";

    for (const account of serviceAccounts) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "bound-account";
      item.dataset.testid = `bound-account-${account.id}`;
      item.textContent = account.alias;
      item.addEventListener("click", () => selectService(account.serviceId, account));
      accountGrid.append(item);
    }

    group.append(heading, accountGrid);
    boundAccountList.append(group);
  }
}

async function showAccount() {
  loginPanel.classList.add("hidden");
  accountPanel.classList.remove("hidden");
  await loadServices();
  await loadBoundAccounts();
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password")
      })
    });
    await showAccount();
    showMessage("เข้าสู่ระบบสำเร็จ");
  } catch (error) {
    showMessage(error.message, true);
  }
});

accountNameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedServiceId) {
    showMessage("กรุณาเลือกบริการก่อน", true);
    return;
  }

  const form = new FormData(event.currentTarget);
  try {
    const name = form.get("name");
    if (selectedBoundAccount) {
      selectedBoundAccount = await request(
        `/api/bindings/${selectedBoundAccount.id}/alias`,
        {
          method: "PATCH",
          body: JSON.stringify({ alias: name })
        }
      );
      boundAccounts = boundAccounts.map((account) =>
        account.id === selectedBoundAccount.id ? selectedBoundAccount : account
      );
      accountTitle.textContent = `${selectedBoundAccount.serviceLabel} · ${selectedBoundAccount.accountId} · ${selectedBoundAccount.alias}`;
      accountNameInput.value = selectedBoundAccount.alias;
      renderBoundAccounts();
    } else {
      const renamedService = await request(`/api/services/${selectedServiceId}/name`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      services = services.map((service) =>
        service.id === renamedService.id ? renamedService : service
      );
      accountTitle.textContent = `${renamedService.label} · ${renamedService.accountId} · ${renamedService.accountName}`;
      accountNameInput.value = renamedService.accountName;
    }
    showMessage("บันทึกชื่อบัญชีแล้ว");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#account-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  accountSearchTerm = document.querySelector("#account-search").value.trim();
  renderBoundAccounts();
});

document.querySelector("#clear-account-search").addEventListener("click", () => {
  document.querySelector("#account-search").value = "";
  accountSearchTerm = "";
  renderBoundAccounts();
});

document.querySelector("#vacant-profile-button").addEventListener("click", () => {
  vacantProfileResults.replaceChildren();
  vacantProfileDialog.showModal();
});

document.querySelector("#close-vacant-profile-dialog").addEventListener("click", () => {
  vacantProfileDialog.close();
});

document
  .querySelector("#vacant-profile-search-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const serviceId = document.querySelector("#vacant-service").value;
    try {
      const result = await request(
        `/api/vacant-profiles?serviceId=${encodeURIComponent(serviceId)}`
      );
      vacantProfileResults.replaceChildren();
      if (result.accounts.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "ยังไม่มีบัญชีที่ Bind สำหรับบริการนี้";
        vacantProfileResults.append(empty);
        return;
      }

      for (const account of result.accounts) {
        const group = document.createElement("section");
        group.className = "vacant-account-group";
        const heading = document.createElement("h3");
        heading.textContent = `${account.alias} · ${account.accountId}`;
        group.append(heading);

        if (account.profiles.length === 0) {
          const noVacancies = document.createElement("p");
          noVacancies.className = "muted";
          noVacancies.textContent = "ไม่มีโปรไฟล์ว่าง";
          group.append(noVacancies);
        } else {
          for (const profile of account.profiles) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "vacant-profile-result";
            button.dataset.testid = `vacant-profile-${account.id}-${profile.id}`;
            button.textContent = `${profile.name} · ว่าง`;
            button.addEventListener("click", async () => {
              const selectedAccount = boundAccounts.find(
                (item) => item.id === account.id
              );
              if (!selectedAccount) {
                showMessage("ไม่พบบัญชีที่เลือก", true);
                return;
              }
              vacantProfileDialog.close();
              await selectService(result.serviceId, selectedAccount);
              if (profiles.some((item) => item.id === profile.id)) {
                selectProfile(profile.id);
              }
            });
            group.append(button);
          }
        }

        vacantProfileResults.append(group);
      }
    } catch (error) {
      vacantProfileResults.replaceChildren();
      const errorMessage = document.createElement("p");
      errorMessage.className = "message error";
      errorMessage.textContent = error.message;
      vacantProfileResults.append(errorMessage);
    }
  });

document.querySelector("#profile-name-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (selectedServiceId === null || selectedProfileId === null) {
    showMessage("กรุณาเลือกบริการและโปรไฟล์ก่อน", true);
    return;
  }

  const form = new FormData(event.currentTarget);
  try {
    const renamedProfile = await request(
      selectedProfileActionUrl(selectedProfileId, "name"),
      {
        method: "PATCH",
        body: JSON.stringify({ name: form.get("name") })
      }
    );
    profiles = await request(selectedProfilesUrl());
    renderProfiles();
    selectProfile(selectedProfileId);
    showMessage(`บันทึกชื่อโปรไฟล์ ${renamedProfile.name} แล้ว`);
  } catch (error) {
    showMessage(error.message, true);
  }
});

function selectProfile(profileId) {
  const service = getSelectedService();
  const profile = profiles.find((item) => item.id === profileId);
  if (!service || !profile) {
    throw new Error("ไม่พบบริการหรือโปรไฟล์ที่เลือก");
  }

  selectedProfileId = profileId;
  profileTitle.textContent = profile.name;
  profileNameInput.value = profile.name;
  currentPin.textContent = `PIN ปัจจุบัน: ${profile.currentPin}`;
  pinStatus.textContent = profile.pinChangedAt
    ? `PIN เปลี่ยนล่าสุด: ${new Date(profile.pinChangedAt).toLocaleString("th-TH")}`
    : "โปรไฟล์นี้ยังไม่เคยเปลี่ยน PIN";
  if (profile.expiryStatus === "active") {
    expiryStatus.textContent =
      `สถานะ: ใช้งานอยู่ · เหลืออีก ${profile.daysRemaining} วัน · หมดอายุ ` +
      new Date(profile.expiresAt).toLocaleDateString("th-TH");
  } else if (profile.expiryStatus === "expired") {
    expiryStatus.textContent =
      "สถานะ: หมดอายุแล้ว · นำโปรไฟล์ออกและหมุน PIN ใหม่แล้ว (จำลอง)";
  } else if (profile.expiryStatus === "revoked") {
    expiryStatus.textContent = "สถานะ: ถูกนำออกแล้วหลังเปลี่ยน PIN (จำลอง)";
  } else {
    expiryStatus.textContent = "สถานะ: ว่าง";
  }
  expiryDateInput.value = profile.expiresAt ? formatExpiryInput(profile.expiresAt) : "";
  newPinInput.pattern = `[0-9]{${service.pinLength}}`;
  newPinInput.maxLength = service.pinLength;
  newPinInput.minLength = service.pinLength;
  pinHint.textContent = `ต้องเป็นตัวเลข ${service.pinLength} หลักสำหรับ ${service.label}`;
  profileDetail.classList.remove("hidden");
  renderProfiles();
  showMessage("");
}

document.querySelector("#pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (selectedServiceId === null || selectedProfileId === null) {
    showMessage("กรุณาเลือกบริการและโปรไฟล์ก่อน", true);
    return;
  }

  const service = getSelectedService();
  if (!service) {
    showMessage("กรุณาเลือกบริการก่อน", true);
    return;
  }

  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    const result = await request(
      selectedProfileActionUrl(selectedProfileId, "pin"),
      {
        method: "POST",
        body: JSON.stringify({ pin: form.get("pin") })
      }
    );
    profiles = await request(selectedProfilesUrl());
    renderProfiles();
    selectProfile(selectedProfileId);
    showMessage(
      `PIN ของ Profile ${selectedProfileId} (${service.label}) เปลี่ยนแล้ว และนำโปรไฟล์ออกจากระบบจำลอง`
    );
    formElement.reset();
    pinStatus.dataset.updatedAt = result.pinChangedAt;
  } catch (error) {
    showMessage(error.message, true);
  }
});

async function refreshSelectedProfile() {
  if (selectedServiceId === null || selectedProfileId === null) {
    return;
  }

  profiles = await request(selectedProfilesUrl());
  renderProfiles();
  selectProfile(selectedProfileId);
}

async function assignExpiry(options, successMessage) {
  if (selectedServiceId === null || selectedProfileId === null) {
    showMessage("กรุณาเลือกบริการและโปรไฟล์ก่อน", true);
    return;
  }

  try {
    await request(
      selectedProfileActionUrl(selectedProfileId, "expiry"),
      {
        method: "POST",
        body: JSON.stringify(options)
      }
    );
    await refreshSelectedProfile();
    showMessage(successMessage);
  } catch (error) {
    showMessage(error.message, true);
  }
}

document.querySelector("#expiry-date-form").addEventListener("submit", (event) => {
  event.preventDefault();
  let expiration;
  try {
    expiration = parseExpiryInput(expiryDateInput.value);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }
  void assignExpiry(
    { expiresAt: expiration.toISOString() },
    "กำหนดวันหมดอายุแล้ว"
  );
});

document.querySelectorAll("[data-expiry-duration]").forEach((button) => {
  button.addEventListener("click", () => {
    const duration = button.dataset.expiryDuration;
    void assignExpiry(
      { duration },
      `กำหนดวันหมดอายุแบบ${button.textContent}แล้ว`
    );
  });
});

document.querySelector("#clear-expiry-button").addEventListener("click", async () => {
  if (selectedServiceId === null || selectedProfileId === null) {
    showMessage("กรุณาเลือกบริการและโปรไฟล์ก่อน", true);
    return;
  }

  try {
    await request(
      selectedProfileActionUrl(selectedProfileId, "expiry"),
      { method: "DELETE" }
    );
    await refreshSelectedProfile();
    showMessage("เคลียร์วันหมดอายุแล้ว โปรไฟล์ว่างและ PIN ถูกหมุนใหม่ (จำลอง)");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#random-pin-button").addEventListener("click", async () => {
  if (selectedServiceId === null || selectedProfileId === null) {
    showMessage("กรุณาเลือกบริการและโปรไฟล์ก่อน", true);
    return;
  }

  const service = getSelectedService();
  if (!service) {
    showMessage("ไม่พบบริการที่เลือก", true);
    return;
  }

  try {
    const result = await request(`/api/services/${service.id}/pin/random`, {
      method: "POST"
    });
    newPinInput.value = result.pin;
    showMessage(
      `สุ่ม PIN ${service.pinLength} หลักแล้ว ตรวจสอบและกดเปลี่ยน PIN เพื่อบันทึก`
    );
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#bind-account-button").addEventListener("click", () => {
  pendingBindingChallengeId = null;
  bindStartForm.reset();
  bindStartForm.querySelector("button[type='submit']").disabled = false;
  bindOtpStep.classList.add("hidden");
  bindMessage.textContent = "";
  bindMessage.classList.remove("error");
  loginStatus.textContent = "กำลังรอเริ่มงาน";
  mockOtpCode.textContent = "";
  mockOtpCode.classList.add("hidden");
  confirmBindButton.disabled = true;
  adminAssistNote.classList.add("hidden");
  bindDialog.showModal();
});

document.querySelector("#close-bind-dialog").addEventListener("click", () => {
  bindDialog.close();
});

bindStartForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const demoPasswordInput = document.querySelector("#bind-demo-password");
  if (!demoPasswordInput.value.trim()) {
    bindMessage.textContent = "กรุณากรอกค่าเดโมในช่องรหัสผ่าน";
    bindMessage.classList.add("error");
    return;
  }

  const form = new FormData(event.currentTarget);
  demoPasswordInput.value = "";
  try {
    const challenge = await request("/api/bindings/start", {
      method: "POST",
      body: JSON.stringify({
        serviceId: form.get("serviceId"),
        email: form.get("email"),
        alias: form.get("alias")
      })
    });
    pendingBindingChallengeId = challenge.challengeId;
    bindOtpStep.dataset.challengeId = challenge.challengeId;
    bindOtpStep.classList.remove("hidden");
    bindStartForm.querySelector("button[type='submit']").disabled = true;
    loginStatus.textContent = "บอทกำลังเข้าสู่บริการจำลองและขอ OTP...";
    loginStatus.classList.remove("error");
    bindMessage.textContent = "";
    bindMessage.classList.remove("error");

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const inboxMessage = await request(
      `/api/mock-mailbox/${pendingBindingChallengeId}`
    );
    document.querySelector("#mock-inbox-message").textContent =
      "บอทอ่าน OTP จากกล่องอีเมลจำลองและกรอกลงหน้าเข้าสู่ระบบจำลองแล้ว";
    mockOtpCode.textContent = `OTP จากอีเมลจำลอง: ${inboxMessage.otp}`;
    mockOtpCode.classList.remove("hidden");
    await request("/api/mock-service-login", {
      method: "POST",
      body: JSON.stringify({
        challengeId: pendingBindingChallengeId,
        otp: inboxMessage.otp
      })
    });
    loginStatus.textContent = "บอทเข้าสู่บริการจำลองสำเร็จ";
    confirmBindButton.disabled = false;
  } catch (error) {
    loginStatus.textContent = "บอทเข้าสู่บริการจำลองไม่สำเร็จ";
    loginStatus.classList.add("error");
    adminAssistNote.classList.remove("hidden");
    bindMessage.textContent = error.message;
    bindMessage.classList.add("error");
    bindStartForm.querySelector("button[type='submit']").disabled = false;
  }
});

document.querySelector("#bind-complete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingBindingChallengeId) {
    bindMessage.textContent = "กรุณาสร้าง OTP จำลองก่อน";
    bindMessage.classList.add("error");
    return;
  }

  try {
    const account = await request("/api/bindings/complete", {
      method: "POST",
      body: JSON.stringify({ challengeId: pendingBindingChallengeId })
    });
    pendingBindingChallengeId = null;
    bindDialog.close();
    await loadBoundAccounts();
    await selectService(account.serviceId, account);
    showMessage(
      `Bind ${account.serviceLabel} สำเร็จ (${account.accountId}) ในระบบจำลอง`
    );
  } catch (error) {
    bindMessage.textContent = error.message;
    bindMessage.classList.add("error");
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/logout", { method: "POST" });
    if (bindDialog.open) {
      bindDialog.close();
    }
    accountPanel.classList.add("hidden");
    loginPanel.classList.remove("hidden");
    profileDetail.classList.add("hidden");
    profileList.classList.add("hidden");
    accountNameForm.classList.add("hidden");
    document.querySelector("#login-form").reset();
    selectedServiceId = null;
    selectedProfileId = null;
    selectedBoundAccount = null;
    services = [];
    profiles = [];
    boundAccounts = [];
    accountSearchTerm = "";
    serviceControls.classList.add("hidden");
    showMessage("ออกจากระบบแล้ว");
  } catch (error) {
    showMessage(error.message, true);
  }
});

request("/api/session")
  .then((result) => (result.authenticated ? showAccount() : undefined))
  .catch((error) => showMessage(error.message, true));
