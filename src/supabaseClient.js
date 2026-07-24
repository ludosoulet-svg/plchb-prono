import { createClient } from "@supabase/supabase-js";

// Ces valeurs sont des identifiants PUBLICS (clé "anon"/"publishable"), conçus pour être exposés
// côté client. La sécurité réelle des données est assurée par les règles RLS côté Supabase, pas
// par le secret de ces valeurs.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://cnocallewutxaqsxbned.supabase.co";
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_eCrdmGWNBCXxVD_mN2_Nqw_lHHuHLum";

export const supabase = createClient(supabaseUrl, supabaseKey);
