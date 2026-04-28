import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let supabaseError = null;

if (!supabaseUrl || !supabaseAnonKey) {
    supabaseError = "Missing Supabase env vars. Create .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
    console.error(supabaseError);
} else {
    try {
        supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
            },
        });
    } catch (err) {
        supabaseError = `Failed to initialize Supabase: ${err.message}`;
        console.error(supabaseError);
    }
}

export { supabase, supabaseError };
