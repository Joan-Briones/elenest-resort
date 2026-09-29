const IPROG_SEND_OTP_URL = "https://www.iprogsms.com/api/v1/otp/send_otp";
const IPROG_VERIFY_OTP_URL = "https://www.iprogsms.com/api/v1/otp/verify_otp";

export type IprogResult = {
  ok: boolean;
  status: number;
  message: string;
  raw?: unknown;
};

export async function sendOtpViaIprog(
  apiToken: string,
  phoneNumber: string,
): Promise<IprogResult> {
  const response = await fetch(IPROG_SEND_OTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_token: apiToken,
      phone_number: phoneNumber,
      message:
        "Your Elenest Resort verification code is :otp. Valid for 5 minutes. Do not share this code.",
      expires_in_minutes: 5,
    }),
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const statusText = String(payload.status ?? "");
  const ok = response.ok && statusText === "success";

  return {
    ok,
    status: response.status,
    message: String(payload.message ?? "Failed to send OTP."),
    raw: payload,
  };
}

export async function verifyOtpViaIprog(
  apiToken: string,
  phoneNumber: string,
  otp: string,
): Promise<IprogResult> {
  const response = await fetch(IPROG_VERIFY_OTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_token: apiToken,
      phone_number: phoneNumber,
      otp,
    }),
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const statusText = String(payload.status ?? "");
  const ok = response.ok && statusText === "success";

  return {
    ok,
    status: response.status,
    message: String(payload.message ?? "OTP verification failed."),
    raw: payload,
  };
}
