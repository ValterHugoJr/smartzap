// Integrações da plataforma (Evolution, Gemini, Google Agenda).
// Os valores salvos pelo super admin no banco (app_config, tela Master →
// Configurações → Integrações da plataforma) têm prioridade; o que estiver
// vazio cai pros segredos do ambiente (cofre da Lovable). Cache curto em
// memória pra não consultar o banco a cada chamada.

export type PlatformSource = "sistema" | "ambiente" | "vazio";

export interface PlatformConfig {
  evolutionUrl: string;
  evolutionKey: string;
  geminiKey: string;
  groqKey: string;
  googleClientId: string;
  googleClientSecret: string;
  sources: {
    evolutionUrl: PlatformSource;
    evolutionKey: PlatformSource;
    geminiKey: PlatformSource;
    groqKey: PlatformSource;
    googleClientId: PlatformSource;
    googleClientSecret: PlatformSource;
  };
}

let cache: { at: number; cfg: PlatformConfig } | null = null;
const TTL_MS = 30_000;

export async function getPlatformConfig(): Promise<PlatformConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cfg;
  let row: any = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_config").select("*").eq("id", true).maybeSingle();
    row = data;
  } catch {}
  const pick = (dbVal: any, envVal: string | undefined): { value: string; source: PlatformSource } => {
    const db = typeof dbVal === "string" ? dbVal.trim() : "";
    if (db) return { value: db, source: "sistema" };
    const env = (envVal || "").trim();
    if (env) return { value: env, source: "ambiente" };
    return { value: "", source: "vazio" };
  };
  const evoUrl = pick(row?.evolution_api_url, process.env.EVOLUTION_API_URL);
  const evoKey = pick(row?.evolution_api_key, process.env.EVOLUTION_API_KEY);
  const gem = pick(row?.gemini_api_key, process.env.GEMINI_API_KEY);
  const grq = pick(row?.groq_api_key, process.env.GROQ_API_KEY);
  const gid = pick(row?.google_client_id, process.env.GOOGLE_CLIENT_ID);
  const gsec = pick(row?.google_client_secret, process.env.GOOGLE_CLIENT_SECRET);
  const cfg: PlatformConfig = {
    evolutionUrl: evoUrl.value.replace(/\/+$/, ""),
    evolutionKey: evoKey.value,
    geminiKey: gem.value,
    groqKey: grq.value,
    googleClientId: gid.value,
    googleClientSecret: gsec.value,
    sources: {
      evolutionUrl: evoUrl.source,
      evolutionKey: evoKey.source,
      geminiKey: gem.source,
      groqKey: grq.source,
      googleClientId: gid.source,
      googleClientSecret: gsec.source,
    },
  };
  cache = { at: Date.now(), cfg };
  return cfg;
}

export async function getGoogleCreds(): Promise<{ id: string; secret: string }> {
  const cfg = await getPlatformConfig();
  return { id: cfg.googleClientId, secret: cfg.googleClientSecret };
}

export function clearPlatformConfigCache() {
  cache = null;
}
