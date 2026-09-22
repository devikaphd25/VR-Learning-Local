/**
 * Server-only Supabase connection.
 *
 * Goal: create the privileged database client used by repositories and server
 * workflows. Depends on SUPABASE_URL and SUPABASE_SECRET_KEY from .env.server.
 * Never import this module into browser code or expose the secret key.
 */
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SECRET_KEY in the server environment."
  );
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: WebSocket as any,
    },
  }
);
