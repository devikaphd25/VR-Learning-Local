/**
 * Browser-safe Supabase client.
 * Depends on VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Use only operations
 * permitted by RLS/RPC grants; privileged writes belong on the Node server.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Will moved to different file once done
export const update = async (room_id: string, current_slide: number) => {
    const { error } = await supabase.rpc("set_slide", {
        input_room_id: room_id,
        input_slide: current_slide,
    })
    if (error) console.error("[ERROR] set_slide ->", error)
}
