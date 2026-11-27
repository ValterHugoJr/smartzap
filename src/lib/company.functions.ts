import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("company_user").select("company_id").eq("user_id", userId).eq("ativo", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!data) throw new Error("Sem empresa.");
  return data.company_id as string;
}

// Slugs que colidem com rotas/áreas do próprio DZap — não podem virar
// slug de empresa.
const RESERVED_SLUGS = new Set([
  "app", "master", "demo", "api", "login", "cadastro", "onboarding",
  "privacidade", "termos", "suporte", "admin", "dzap", "www", "blog",
  "precos", "planos", "ajuda", "conta",
]);

// Atualiza o slug público da empresa do usuário logado. A checagem de
// unicidade precisa enxergar as OUTRAS empresas, então roda com
// supabaseAdmin (service role), sempre filtrando pela empresa resolvida
// da sessão — mesmo expediente de voice.functions.
export const updateMyCompanySlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const slug = String(data?.slug || "").trim().toLowerCase();
    if (slug.length < 3 || slug.length > 40) {
      throw new Error("O slug precisa ter entre 3 e 40 caracteres.");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error("Use só letras minúsculas, números e hífen (sem espaços, acentos ou hífen no começo/fim).");
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new Error("Este slug é reservado. Escolha outro.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: clash } = await (supabaseAdmin as any)
      .from("company")
      .select("id")
      .eq("slug", slug)
      .neq("id", companyId)
      .maybeSingle();
    if (clash) throw new Error("Este slug já está em uso por outra empresa.");
    const { error } = await (supabaseAdmin as any)
      .from("company")
      .update({ slug })
      .eq("id", companyId);
    if (error) {
      if (/duplicate|unique/i.test(String(error.message || ""))) {
        throw new Error("Este slug já está em uso por outra empresa.");
      }
      throw error;
    }
    return { slug };
  });
