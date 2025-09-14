import crypto from "crypto";

export function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [key, value] of params.entries()) {
    if (key === "user" || key === "receiver" || key === "chat") {
      try {
        data[key] = JSON.parse(value);
      } catch {
        data[key] = null;
      }
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function checkWebAppData(initData, botToken) {
  if (!initData) return false;
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");

  const dataCheckString = [...urlParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return computed === hash;
}

export function getAuthorizedUser(initData, botToken) {
  if (!checkWebAppData(initData, botToken)) return null;
  const data = parseInitData(initData);
  return data.user || null;
}
