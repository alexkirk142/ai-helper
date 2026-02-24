import {
  DelayProfile,
  DelayProfileName,
  DelayProfiles,
  DelayCalculationResult,
  NightMode,
  HumanDelaySettings,
  Tenant,
  DEFAULT_DELAY_PROFILES,
} from "@shared/schema";

export interface HumanDelayInput {
  messageLength: number;
  settings: HumanDelaySettings;
  tenant: Pick<Tenant, "workingHoursStart" | "workingHoursEnd" | "timezone">;
  profileOverride?: DelayProfileName;
}

export interface HumanDelayResult {
  delay: DelayCalculationResult;
  shouldSend: boolean;
  nightModeAction: NightMode | null;
  autoReplyText?: string;
}

function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 9 * 60;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function isWithinWorkingHours(
  workingHoursStart: string | null | undefined,
  workingHoursEnd: string | null | undefined,
  timezone: string
): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === "hour");
    const minutePart = parts.find(p => p.type === "minute");
    const currentHour = parseInt(hourPart?.value || "12", 10);
    const currentMinute = parseInt(minutePart?.value || "0", 10);
    const currentMinutes = currentHour * 60 + currentMinute;

    const startMinutes = parseTimeToMinutes(workingHoursStart);
    const endMinutes = parseTimeToMinutes(workingHoursEnd);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch {
    return true;
  }
}

function selectProfile(messageLength: number): DelayProfileName {
  if (messageLength < 100) return "SHORT";
  if (messageLength < 300) return "MEDIUM";
  return "LONG";
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomJitter(maxJitter: number): number {
  return randomInRange(-maxJitter, maxJitter);
}

export function calculateDelay(input: HumanDelayInput): DelayCalculationResult {
  const { messageLength, settings, tenant, profileOverride } = input;

  const profileName = profileOverride || selectProfile(messageLength);
  const profiles = (settings.delayProfiles as DelayProfiles) || DEFAULT_DELAY_PROFILES;
  const profile: DelayProfile = profiles[profileName] || DEFAULT_DELAY_PROFILES[profileName];

  const baseDelayMs = randomInRange(profile.baseMin, profile.baseMax);
  const typingDelayMs = Math.round((messageLength / profile.typingSpeed) * 1000);
  const jitterMs = randomJitter(profile.jitter);

  const isNightMode = !isWithinWorkingHours(
    tenant.workingHoursStart,
    tenant.workingHoursEnd,
    tenant.timezone
  );

  let nightMultiplier = 1.0;
  if (isNightMode && settings.nightMode === "DELAY") {
    nightMultiplier = settings.nightDelayMultiplier || 3.0;
  }

  let calculatedDelayMs = (baseDelayMs + typingDelayMs + jitterMs) * nightMultiplier;
  calculatedDelayMs = Math.max(settings.minDelayMs || 3000, calculatedDelayMs);
  calculatedDelayMs = Math.min(settings.maxDelayMs || 120000, calculatedDelayMs);
  calculatedDelayMs = Math.round(calculatedDelayMs);

  return {
    profileUsed: profileName,
    calculatedDelayMs,
    isNightMode,
    nightMultiplierApplied: nightMultiplier,
    typingDelayMs,
    baseDelayMs,
    jitterMs,
    finalDelayMs: calculatedDelayMs,
  };
}

export function computeHumanDelay(input: HumanDelayInput): HumanDelayResult {
  const { settings, tenant } = input;

  if (!settings.enabled) {
    return {
      delay: {
        profileUsed: "SHORT",
        calculatedDelayMs: 0,
        isNightMode: false,
        nightMultiplierApplied: 1.0,
        typingDelayMs: 0,
        baseDelayMs: 0,
        jitterMs: 0,
        finalDelayMs: 0,
      },
      shouldSend: true,
      nightModeAction: null,
    };
  }

  const isNightMode = !isWithinWorkingHours(
    tenant.workingHoursStart,
    tenant.workingHoursEnd,
    tenant.timezone
  );

  if (isNightMode && settings.nightMode === "AUTO_REPLY") {
    return {
      delay: {
        profileUsed: "SHORT",
        calculatedDelayMs: 0,
        isNightMode: true,
        nightMultiplierApplied: 1.0,
        typingDelayMs: 0,
        baseDelayMs: 0,
        jitterMs: 0,
        finalDelayMs: 0,
      },
      shouldSend: true,
      nightModeAction: "AUTO_REPLY",
      autoReplyText: settings.nightAutoReplyText || "Спасибо за сообщение! Мы ответим в рабочее время.",
    };
  }

  if (isNightMode && settings.nightMode === "DISABLE") {
    return {
      delay: {
        profileUsed: "SHORT",
        calculatedDelayMs: 0,
        isNightMode: true,
        nightMultiplierApplied: 1.0,
        typingDelayMs: 0,
        baseDelayMs: 0,
        jitterMs: 0,
        finalDelayMs: 0,
      },
      shouldSend: false,
      nightModeAction: "DISABLE",
    };
  }

  const delay = calculateDelay(input);

  return {
    delay,
    shouldSend: true,
    nightModeAction: isNightMode ? "DELAY" : null,
  };
}

export async function scheduleDelayedSend(
  delayMs: number,
  sendFn: () => Promise<void>
): Promise<void> {
  if (delayMs <= 0) {
    await sendFn();
    return;
  }

  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        await sendFn();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, delayMs);
  });
}

export function getDefaultHumanDelaySettings(tenantId: string): HumanDelaySettings {
  return {
    tenantId,
    enabled: false,
    delayProfiles: DEFAULT_DELAY_PROFILES,
    nightMode: "DELAY",
    nightDelayMultiplier: 3.0,
    nightAutoReplyText: "Спасибо за сообщение! Мы ответим в рабочее время.",
    minDelayMs: 3000,
    maxDelayMs: 120000,
    typingIndicatorEnabled: true,
    updatedAt: new Date(),
  };
}
