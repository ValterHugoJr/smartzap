import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("company_user").select("company_id").eq("user_id", userId).eq("ativo", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!data) throw new Error("Sem empresa.");
  return data.company_id as string;
}

// A tabela voice_config tem RLS ligado sem policy pública (acesso só via
// service_role, como google_integration) — por isso lemos/gravamos com
// supabaseAdmin, sempre filtrando pela empresa do usuário logado.
// Os tipos gerados ainda não conhecem voice_config (migração 0001), daí
// o `as any` — mesmo expediente do groq_api_key em platform-config.

// Normaliza telefone brasileiro: só dígitos; 10/11 dígitos (DDD+número)
// ganham o DDI 55. Já com DDI (12/13 dígitos começando em 55) fica como está.
function normalizeBrPhone(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) return `55${d}`;
  return d;
}

export type MyVoiceConfig = {
  enabled: boolean;
  phone_number: string;
  greeting: string;
  default_greeting: string;
};

export const getMyVoiceConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyVoiceConfig> => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("voice_config")
      .select("*")
      .eq("company_id", cid)
      .maybeSingle();
    // Saudação padrão (apresentacao do agente ou padrão montado) pra
    // usar de placeholder no campo — mesma lógica do worker de voz.
    const { getVoiceCompanyConfig } = await import("@/lib/voice.server");
    const full = await getVoiceCompanyConfig(supabaseAdmin, {
      company_id: cid,
      greeting: "",
      enabled: !!(data as any)?.enabled,
    }).catch(() => null);
    return {
      enabled: !!(data as any)?.enabled,
      phone_number: ((data as any)?.phone_number as string) || "",
      greeting: ((data as any)?.greeting as string) || "",
      default_greeting: full?.greeting || "",
    };
  });

export const setMyVoiceConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean; phone_number: string; greeting: string }) => d)
  .handler(async ({ context, data }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const phone = normalizeBrPhone(data.phone_number);
    if (phone && phone.length < 12) throw new Error("Número incompleto — informe DDD + número (com ou sem o 55).");
    if (data.enabled && !phone) throw new Error("Informe o número de telefone para ativar o atendimento por voz.");
    const greeting = String(data.greeting || "").trim().slice(0, 500);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (phone) {
      const { data: other } = await (supabaseAdmin as any)
        .from("voice_config")
        .select("company_id")
        .eq("phone_number", phone)
        .neq("company_id", cid)
        .maybeSingle();
      if (other) throw new Error("Este número já está atribuído a outra empresa. Fale com a equipe V2.");
    }
    const { error } = await (supabaseAdmin as any)
      .from("voice_config")
      .upsert(
        { company_id: cid, enabled: !!data.enabled, phone_number: phone, greeting, updated_at: new Date().toISOString() },
        { onConflict: "company_id" },
      );
    if (error) {
      if (/voice_config_phone_number_uidx|duplicate key/i.test(error.message)) {
        throw new Error("Este número já está atribuído a outra empresa. Fale com a equipe V2.");
      }
      throw new Error(error.message);
    }
    return { ok: true as const, phone_number: phone };
  });
