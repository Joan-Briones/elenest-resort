import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { verifyOtpViaIprog } from "../_shared/iprog.ts";
import {
  isValidPhilippinePhone,
  normalizePhilippinePhone,
} from "../_shared/phone.ts";

const OTP_RE = /^[0-9]{4,8}$/;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const apiToken = Deno.env.get("IPROG_SMS_API_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!apiToken) {
    console.error("IPROG_SMS_API_TOKEN is not configured.");
    return jsonResponse(
      { ok: false, message: "SMS service is not configured." },
      500,
    );
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase service credentials missing.");
    return jsonResponse(
      { ok: false, message: "Server configuration error." },
      500,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, message: "Invalid JSON body." }, 400);
  }

  const phoneNumber = normalizePhilippinePhone(body.phone_number);
  const otp = String(body.otp ?? "").trim();

  if (!phoneNumber || !isValidPhilippinePhone(phoneNumber)) {
    return jsonResponse(
      {
        ok: false,
        message:
          "Invalid phone number. Use Philippine mobile format: 09XXXXXXXXX.",
      },
      400,
    );
  }

  if (!OTP_RE.test(otp)) {
    return jsonResponse(
      { ok: false, message: "Invalid OTP format." },
      400,
    );
  }

  const result = await verifyOtpViaIprog(apiToken, phoneNumber, otp);
  if (!result.ok) {
    return jsonResponse(
      { ok: false, message: result.message || "Invalid or expired OTP." },
      401,
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await admin.from("users").upsert(
    {
      phone_number: phoneNumber,
      is_verified: true,
    },
    { onConflict: "phone_number" },
  );

  if (error) {
    console.error("Failed to update users table:", error.message);
    return jsonResponse(
      { ok: false, message: "OTP verified but account update failed." },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    message: "OTP verified successfully.",
    phone_number: phoneNumber,
    is_verified: true,
  });
});
