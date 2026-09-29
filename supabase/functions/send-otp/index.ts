import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { sendOtpViaIprog } from "../_shared/iprog.ts";
import {
  isValidPhilippinePhone,
  normalizePhilippinePhone,
} from "../_shared/phone.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const apiToken = Deno.env.get("IPROG_SMS_API_TOKEN");
  if (!apiToken) {
    console.error("IPROG_SMS_API_TOKEN is not configured.");
    return jsonResponse(
      { ok: false, message: "SMS service is not configured." },
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceRoleKey) {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const existing = await admin
      .from("users")
      .select("id")
      .eq("phone_number", phoneNumber)
      .maybeSingle();
    if (!existing.data) {
      await admin.from("users").insert({
        phone_number: phoneNumber,
        is_verified: false,
      });
    }
  }

  const result = await sendOtpViaIprog(apiToken, phoneNumber);
  if (!result.ok) {
    console.error("iProg send_otp failed:", result.message, result.raw);
    return jsonResponse(
      { ok: false, message: result.message || "Could not send OTP." },
      502,
    );
  }

  // Never expose OTP code from iProg response to the client.
  return jsonResponse({
    ok: true,
    message: "OTP sent successfully. Check your phone.",
    phone_number: phoneNumber,
  });
});
