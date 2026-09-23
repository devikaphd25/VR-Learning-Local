/**
 * Persistent device identity helper.
 * Goal: let one physical headset reuse one app_users identity and fixed seat.
 * Quest uses durable localStorage; desktop tabs receive separate test IDs so
 * multiple students can be simulated in one browser.
 */
const DEVICE_ID_STORAGE_KEY = "vrDeviceId";

export function getPersistentDeviceId(): string {
  /*
   * A physical Quest keeps one permanent ID across browser sessions.
   * Desktop testing uses one ID per tab so two tabs represent two students
   * instead of overwriting the same Supabase participant/app_user.
   */
  const isQuestBrowser = /OculusBrowser|Meta Quest|Quest/i.test(
    navigator.userAgent
  );
  const storage = isQuestBrowser ? localStorage : sessionStorage;
  const existingDeviceId = storage.getItem(DEVICE_ID_STORAGE_KEY);

  if (existingDeviceId) {
    return existingDeviceId;
  }

  const deviceId = generateUUID();
  storage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}

/**
 * RFC 4122 v4 UUID. `crypto.randomUUID()` only exists in secure contexts
 * (HTTPS or localhost), so fall back when serving over a plain-HTTP network URL.
 */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
