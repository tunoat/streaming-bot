import express, { type NextFunction, type Request, type Response } from "express";
import dotenv from "dotenv";
import session from "express-session";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, "../../.env") });

declare module "express-session" {
  interface SessionData {
    isAdmin?: boolean;
  }
}

interface Profile {
  id: number;
  name: string;
  pin: string;
  pinChangedAt: string | null;
  expiresAt: string | null;
  accessRevokedAt: string | null;
  revocationReason: "expired" | "pin_changed" | "cleared" | null;
}

interface StreamingService {
  id: string;
  label: string;
  accountId: string;
  accountName: string;
  pinLength: number;
  initialPin: string;
  profiles: Profile[];
}

interface BoundAccount {
  id: string;
  serviceId: string;
  serviceLabel: string;
  accountId: string;
  email: string;
  alias: string;
  boundAt: string;
  profiles: Profile[];
}

interface PendingBinding {
  sessionId: string;
  serviceId: string;
  email: string;
  alias: string;
  otp: string;
  expiresAt: number;
  otpFetchedAt: number | null;
  loginStatus: "pending" | "success" | "failed";
}

function requiredEnvironmentValue(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const adminUsername = requiredEnvironmentValue("ADMIN_USERNAME");
const adminPassword = requiredEnvironmentValue("ADMIN_PASSWORD");
const sessionSecret = requiredEnvironmentValue("SESSION_SECRET");

const services: StreamingService[] = [
  {
    id: "netflix",
    label: "Netflix",
    accountId: "NF-001",
    accountName: "Netflix Account",
    pinLength: 4,
    initialPin: "",
    profiles: []
  },
  {
    id: "prime",
    label: "Prime",
    accountId: "PR-001",
    accountName: "Prime Account",
    pinLength: 5,
    initialPin: "",
    profiles: []
  },
  {
    id: "hbo",
    label: "HBO",
    accountId: "HB-001",
    accountName: "HBO Account",
    pinLength: 4,
    initialPin: "",
    profiles: []
  },
  {
    id: "disney",
    label: "Disney",
    accountId: "DS-001",
    accountName: "Disney Account",
    pinLength: 4,
    initialPin: "",
    profiles: []
  }
];
const boundAccounts: BoundAccount[] = [];
const pendingBindings = new Map<string, PendingBinding>();

const initialPinEnvironment: Record<string, string> = {
  netflix: "INITIAL_PROFILE_PIN",
  prime: "INITIAL_PRIME_PIN",
  hbo: "INITIAL_HBO_PIN",
  disney: "INITIAL_DISNEY_PIN"
};

for (const service of services) {
  const initialPin = requiredEnvironmentValue(initialPinEnvironment[service.id]);
  if (!new RegExp(`^\\d{${service.pinLength}}$`).test(initialPin)) {
    throw new Error(
      `${initialPinEnvironment[service.id]} must contain exactly ${service.pinLength} digits`
    );
  }
  service.initialPin = initialPin;
  service.profiles = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    name: `Profile ${index + 1}`,
    pin: initialPin,
    pinChangedAt: null,
    expiresAt: null,
    accessRevokedAt: null,
    revocationReason: null
  }));
}

function generatePin(service: StreamingService, exclude?: string): string {
  let pin = String(randomInt(0, 10 ** service.pinLength)).padStart(
    service.pinLength,
    "0"
  );
  while (pin === exclude) {
    pin = String(randomInt(0, 10 ** service.pinLength)).padStart(
      service.pinLength,
      "0"
    );
  }
  return pin;
}

function expireDueProfiles(now = Date.now()): void {
  const profileCollections = [
    ...services.map((service) => ({ service, profiles: service.profiles })),
    ...boundAccounts.flatMap((account) => {
      const service = findService(account.serviceId);
      return service ? [{ service, profiles: account.profiles }] : [];
    })
  ];

  for (const { service, profiles } of profileCollections) {
    for (const profile of profiles) {
      if (
        profile.expiresAt !== null &&
        Date.parse(profile.expiresAt) <= now &&
        profile.revocationReason !== "expired"
      ) {
        const timestamp = new Date(now).toISOString();
        profile.accessRevokedAt = timestamp;
        profile.revocationReason = "expired";
        profile.pin = generatePin(service, profile.pin);
        profile.pinChangedAt = timestamp;
      }
    }
  }
}

function profileResponse(profile: Profile, now = Date.now()) {
  const expiryTime = profile.expiresAt === null ? null : Date.parse(profile.expiresAt);
  let expiryStatus: "vacant" | "active" | "expired" | "revoked";
  if (
    profile.revocationReason === "expired" ||
    (expiryTime !== null && expiryTime <= now)
  ) {
    expiryStatus = "expired";
  } else if (profile.revocationReason === "pin_changed") {
    expiryStatus = "revoked";
  } else if (profile.expiresAt === null) {
    expiryStatus = "vacant";
  } else {
    expiryStatus = "active";
  }

  const daysRemaining =
    expiryTime === null
      ? null
      : Math.max(0, Math.ceil((expiryTime - now) / (24 * 60 * 60 * 1000)));
  return {
    id: profile.id,
    name: profile.name,
    currentPin: profile.pin,
    pinChangedAt: profile.pinChangedAt,
    expiresAt: profile.expiresAt,
    expiryStatus,
    daysRemaining,
    accessRevokedAt: profile.accessRevokedAt
  };
}

function addExpiryDuration(
  date: Date,
  duration: "day" | "week" | "month" | "year"
): Date {
  if (duration === "day") {
    date.setDate(date.getDate() + 1);
    return date;
  }
  if (duration === "week") {
    date.setDate(date.getDate() + 7);
    return date;
  }

  const dayOfMonth = date.getDate();
  date.setDate(1);
  if (duration === "month") {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 1);
  }
  const lastDayOfMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  date.setDate(Math.min(dayOfMonth, lastDayOfMonth));
  return date;
}

const expirySweep = setInterval(expireDueProfiles, 30_000);
expirySweep.unref();

function findService(serviceId: string | string[]): StreamingService | undefined {
  const id = singlePathParam(serviceId);
  return services.find((service) => service.id === id);
}

function singlePathParam(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

function findProfile(profiles: Profile[], profileId: string | string[]): Profile | undefined {
  const id = Number(singlePathParam(profileId));
  return profiles.find((profile) => profile.id === id);
}

function findProfilesForService(
  service: StreamingService,
  accountId: unknown
): Profile[] | undefined {
  if (accountId === undefined) {
    return service.profiles;
  }
  if (typeof accountId !== "string") {
    return undefined;
  }

  const account = boundAccounts.find(
    (item) => item.id === accountId && item.serviceId === service.id
  );
  return account?.profiles;
}

function boundAccountResponse(account: BoundAccount) {
  const { profiles: _profiles, ...summary } = account;
  return summary;
}

const app = express();
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}

app.use(express.json({ limit: "10kb" }));
app.use(
  session({
    name: "streaming-bot.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 30 * 60 * 1000
    }
  })
);

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.isAdmin) {
    res.status(401).json({ message: "กรุณาเข้าสู่ระบบผู้ดูแลก่อน" });
    return;
  }
  next();
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body as {
    username?: unknown;
    password?: unknown;
  };

  if (username !== adminUsername || password !== adminPassword) {
    res.status(401).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    return;
  }

  req.session.isAdmin = true;
  res.json({ authenticated: true });
});

app.post("/api/logout", requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }
    res.clearCookie("streaming-bot.sid");
    res.json({ authenticated: false });
  });
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session.isAdmin) });
});

app.get("/api/services", requireAdmin, (_req, res) => {
  res.json(
    services.map(({ id, label, accountId, accountName, pinLength }) => ({
      id,
      label,
      accountId,
      accountName,
      pinLength
    }))
  );
});

app.get("/api/bindings", requireAdmin, (_req, res) => {
  res.json(boundAccounts.map(boundAccountResponse));
});

app.get("/api/vacant-profiles", requireAdmin, (req, res) => {
  const serviceId = req.query.serviceId;
  if (typeof serviceId !== "string") {
    res.status(400).json({ message: "กรุณาเลือกบริการเพื่อค้นหาโปรไฟล์ว่าง" });
    return;
  }

  const service = findService(serviceId);
  if (!service) {
    res.status(404).json({ message: "ไม่พบบริการนี้" });
    return;
  }

  expireDueProfiles();
  const accounts = boundAccounts
    .filter((account) => account.serviceId === service.id)
    .map((account) => ({
      id: account.id,
      accountId: account.accountId,
      alias: account.alias,
      profiles: account.profiles
        .map((profile) => profileResponse(profile))
        .filter((profile) => profile.expiryStatus === "vacant")
        .map(({ id, name }) => ({ id, name }))
    }));

  res.json({ serviceId: service.id, serviceLabel: service.label, accounts });
});

app.post("/api/bindings/start", requireAdmin, (req, res) => {
  const { serviceId, email, alias } = req.body as {
    serviceId?: unknown;
    email?: unknown;
    alias?: unknown;
  };
  if (typeof serviceId !== "string" || !findService(serviceId)) {
    res.status(400).json({ message: "กรุณาเลือกบริการที่รองรับ" });
    return;
  }
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    res.status(400).json({ message: "กรุณากรอกอีเมลที่ถูกต้อง" });
    return;
  }
  if (
    typeof alias !== "string" ||
    !alias.trim() ||
    alias.trim().length > 60
  ) {
    res.status(400).json({ message: "Alias ต้องมี 1 ถึง 60 ตัวอักษร" });
    return;
  }
  if (
    boundAccounts.some(
      (account) =>
        account.serviceId === serviceId &&
        account.email.toLowerCase() === email.toLowerCase()
    )
  ) {
    res.status(409).json({ message: "อีเมลนี้ bind กับบริการนี้แล้ว" });
    return;
  }

  const challengeId = randomUUID();
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  pendingBindings.set(challengeId, {
    sessionId: req.sessionID,
    serviceId,
    email,
    alias: alias.trim(),
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000,
    otpFetchedAt: null,
    loginStatus: "pending"
  });
  res.status(201).json({
    challengeId,
    alias: alias.trim(),
    expiresInSeconds: 300
  });
});

app.get("/api/mock-mailbox/:challengeId", requireAdmin, (req, res) => {
  const challengeId = singlePathParam(req.params.challengeId);
  const challenge = pendingBindings.get(challengeId);
  if (!challenge || challenge.sessionId !== req.sessionID) {
    res.status(404).json({ message: "ไม่พบ OTP ในกล่องอีเมลจำลอง" });
    return;
  }
  if (challenge.expiresAt < Date.now()) {
    pendingBindings.delete(challengeId);
    res.status(410).json({ message: "OTP หมดอายุแล้ว" });
    return;
  }

  const service = findService(challenge.serviceId);
  challenge.otpFetchedAt = Date.now();
  res.json({
    recipient: challenge.email,
    subject: `${service?.label ?? "Streaming"} sign-in code`,
    otp: challenge.otp
  });
});

app.post("/api/mock-service-login", requireAdmin, (req, res) => {
  const { challengeId, otp } = req.body as {
    challengeId?: unknown;
    otp?: unknown;
  };
  if (typeof challengeId !== "string" || typeof otp !== "string") {
    res.status(400).json({ message: "ข้อมูลเข้าสู่ระบบจำลองไม่ครบ" });
    return;
  }

  const challenge = pendingBindings.get(challengeId);
  if (!challenge || challenge.sessionId !== req.sessionID) {
    res.status(404).json({ message: "ไม่พบรายการเข้าสู่ระบบจำลอง" });
    return;
  }
  if (challenge.expiresAt < Date.now()) {
    pendingBindings.delete(challengeId);
    res.status(410).json({ message: "OTP หมดอายุแล้ว" });
    return;
  }
  if (challenge.otpFetchedAt === null) {
    res.status(409).json({ message: "บอทยังไม่ได้อ่าน OTP จากกล่องอีเมลจำลอง" });
    return;
  }
  if (otp !== challenge.otp) {
    challenge.loginStatus = "failed";
    res.status(401).json({ message: "เข้าสู่บริการจำลองไม่สำเร็จ: OTP ไม่ถูกต้อง" });
    return;
  }

  challenge.loginStatus = "success";
  res.json({ status: challenge.loginStatus });
});

app.post("/api/bindings/complete", requireAdmin, (req, res) => {
  const { challengeId } = req.body as { challengeId?: unknown };
  if (typeof challengeId !== "string") {
    res.status(400).json({ message: "ไม่พบรายการยืนยันการ Bind" });
    return;
  }

  const challenge = pendingBindings.get(challengeId);
  if (!challenge || challenge.sessionId !== req.sessionID) {
    res.status(404).json({ message: "ไม่พบรายการยืนยันนี้ กรุณาเริ่มใหม่" });
    return;
  }
  if (challenge.expiresAt < Date.now()) {
    pendingBindings.delete(challengeId);
    res.status(410).json({ message: "OTP หมดอายุแล้ว กรุณาสร้างรหัสใหม่" });
    return;
  }
  if (challenge.loginStatus !== "success") {
    res.status(409).json({ message: "กรุณารอให้บอทเข้าสู่บริการจำลองสำเร็จก่อน" });
    return;
  }

  const service = findService(challenge.serviceId);
  if (!service) {
    pendingBindings.delete(challengeId);
    res.status(404).json({ message: "ไม่พบบริการนี้" });
    return;
  }

  const prefix = service.accountId.slice(0, service.accountId.lastIndexOf("-"));
  const sequence =
    boundAccounts.filter((account) => account.serviceId === service.id).length + 2;
  const boundAccount: BoundAccount = {
    id: randomUUID(),
    serviceId: service.id,
    serviceLabel: service.label,
    accountId: `${prefix}-${String(sequence).padStart(3, "0")}`,
    email: challenge.email,
    alias: challenge.alias,
    boundAt: new Date().toISOString(),
    profiles: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      name: `Profile ${index + 1}`,
      pin: service.initialPin,
      pinChangedAt: null,
      expiresAt: null,
      accessRevokedAt: null,
      revocationReason: null
    }))
  };
  boundAccounts.push(boundAccount);
  pendingBindings.delete(challengeId);
  res.status(201).json(boundAccountResponse(boundAccount));
});

app.patch("/api/bindings/:id/alias", requireAdmin, (req, res) => {
  const id = singlePathParam(req.params.id);
  const account = boundAccounts.find((item) => item.id === id);
  if (!account) {
    res.status(404).json({ message: "ไม่พบบัญชีที่ Bind นี้" });
    return;
  }

  const { alias } = req.body as { alias?: unknown };
  if (typeof alias !== "string" || !alias.trim() || alias.trim().length > 60) {
    res.status(400).json({ message: "Alias ต้องมี 1 ถึง 60 ตัวอักษร" });
    return;
  }

  account.alias = alias.trim();
  res.json(boundAccountResponse(account));
});

app.patch("/api/services/:serviceId/name", requireAdmin, (req, res) => {
  const service = findService(req.params.serviceId);
  if (!service) {
    res.status(404).json({ message: "ไม่พบบริการนี้" });
    return;
  }

  const { name } = req.body as { name?: unknown };
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
    res.status(400).json({ message: "ชื่อบัญชีต้องมี 1 ถึง 60 ตัวอักษร" });
    return;
  }

  service.accountName = name.trim();
  res.json({
    id: service.id,
    label: service.label,
    accountId: service.accountId,
    accountName: service.accountName,
    pinLength: service.pinLength
  });
});

app.get("/api/services/:serviceId/profiles", requireAdmin, (req, res) => {
  const service = findService(req.params.serviceId);
  if (!service) {
    res.status(404).json({ message: "ไม่พบบริการนี้" });
    return;
  }
  const profiles = findProfilesForService(service, req.query.accountId);
  if (!profiles) {
    res.status(404).json({ message: "ไม่พบบัญชีนี้ในบริการที่เลือก" });
    return;
  }

  expireDueProfiles();
  res.json(profiles.map((profile) => profileResponse(profile)));
});

app.patch(
  "/api/services/:serviceId/profiles/:id/name",
  requireAdmin,
  (req, res) => {
    const service = findService(req.params.serviceId);
    if (!service) {
      res.status(404).json({ message: "ไม่พบบริการนี้" });
      return;
    }

    const profiles = findProfilesForService(service, req.query.accountId);
    if (!profiles) {
      res.status(404).json({ message: "ไม่พบบัญชีนี้ในบริการที่เลือก" });
      return;
    }

    const profile = findProfile(profiles, req.params.id);
    if (!profile) {
      res.status(404).json({ message: "ไม่พบโปรไฟล์นี้" });
      return;
    }

    const { name } = req.body as { name?: unknown };
    if (typeof name !== "string" || !name.trim() || name.trim().length > 40) {
      res.status(400).json({ message: "ชื่อโปรไฟล์ต้องมี 1 ถึง 40 ตัวอักษร" });
      return;
    }

    profile.name = name.trim();
    res.json({ id: profile.id, name: profile.name });
  }
);

app.post(
  "/api/services/:serviceId/profiles/:id/pin",
  requireAdmin,
  (req, res) => {
    const service = findService(req.params.serviceId);
    if (!service) {
      res.status(404).json({ message: "ไม่พบบริการนี้" });
      return;
    }

    const profiles = findProfilesForService(service, req.query.accountId);
    if (!profiles) {
      res.status(404).json({ message: "ไม่พบบัญชีนี้ในบริการที่เลือก" });
      return;
    }

    const profile = findProfile(profiles, req.params.id);
    if (!profile) {
      res.status(404).json({ message: "ไม่พบโปรไฟล์นี้" });
      return;
    }

    const { pin } = req.body as { pin?: unknown };
    if (
      typeof pin !== "string" ||
      !new RegExp(`^\\d{${service.pinLength}}$`).test(pin)
    ) {
      res
        .status(400)
        .json({ message: `PIN ของ ${service.label} ต้องเป็นตัวเลข ${service.pinLength} หลัก` });
      return;
    }

    profile.pin = pin;
    const timestamp = new Date().toISOString();
    profile.pinChangedAt = timestamp;
    profile.accessRevokedAt = timestamp;
    profile.revocationReason = "pin_changed";
    res.json({ updated: true, pinChangedAt: timestamp });
  }
);

app.post(
  "/api/services/:serviceId/profiles/:id/expiry",
  requireAdmin,
  (req, res) => {
    const service = findService(req.params.serviceId);
    if (!service) {
      res.status(404).json({ message: "ไม่พบบริการนี้" });
      return;
    }

    const profiles = findProfilesForService(service, req.query.accountId);
    if (!profiles) {
      res.status(404).json({ message: "ไม่พบบัญชีนี้ในบริการที่เลือก" });
      return;
    }

    const profile = findProfile(profiles, req.params.id);
    if (!profile) {
      res.status(404).json({ message: "ไม่พบโปรไฟล์นี้" });
      return;
    }

    const { duration, expiresAt } = req.body as {
      duration?: unknown;
      expiresAt?: unknown;
    };
    let expiration: Date;
    if (
      duration === "day" ||
      duration === "week" ||
      duration === "month" ||
      duration === "year"
    ) {
      expiration = addExpiryDuration(new Date(), duration);
    } else if (typeof expiresAt === "string") {
      expiration = new Date(expiresAt);
    } else {
      res.status(400).json({ message: "เลือกช่วงเวลาหรือกำหนดวันหมดอายุ" });
      return;
    }

    if (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= Date.now()) {
      res.status(400).json({ message: "วันหมดอายุต้องเป็นวันในอนาคต" });
      return;
    }

    profile.expiresAt = expiration.toISOString();
    profile.accessRevokedAt = null;
    profile.revocationReason = null;
    res.json(profileResponse(profile));
  }
);

app.delete(
  "/api/services/:serviceId/profiles/:id/expiry",
  requireAdmin,
  (req, res) => {
    const service = findService(req.params.serviceId);
    if (!service) {
      res.status(404).json({ message: "ไม่พบบริการนี้" });
      return;
    }

    const profiles = findProfilesForService(service, req.query.accountId);
    if (!profiles) {
      res.status(404).json({ message: "ไม่พบบัญชีนี้ในบริการที่เลือก" });
      return;
    }

    const profile = findProfile(profiles, req.params.id);
    if (!profile) {
      res.status(404).json({ message: "ไม่พบโปรไฟล์นี้" });
      return;
    }

    const timestamp = new Date().toISOString();
    profile.expiresAt = null;
    profile.accessRevokedAt = timestamp;
    profile.revocationReason = "cleared";
    profile.pin = generatePin(service, profile.pin);
    profile.pinChangedAt = timestamp;
    res.json(profileResponse(profile));
  }
);

app.post("/api/services/:serviceId/pin/random", requireAdmin, (req, res) => {
  const service = findService(req.params.serviceId);
  if (!service) {
    res.status(404).json({ message: "ไม่พบบริการนี้" });
    return;
  }

  res.json({ pin: generatePin(service) });
});

app.use(express.static(resolve(currentDirectory, "../public")));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Request failed:", error);
  res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Demo web is running at http://127.0.0.1:${port}`);
});
