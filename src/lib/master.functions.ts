import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { slugify } from "@/lib/tenant";

async function assertSuper(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Acesso negado");
}

export const masterKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: companies }, { count: msgCount }, { count: cardsCount }, { data: subscriptions }] = await Promise.all([
      supabaseAdmin.from("company").select("id, status_cobranca, trial_ate, created_at"),
      supabaseAdmin.from("mensagens").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("crm_cards").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("subscription").select("status, plan:plan(preco_cents)"),
    ]);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const all = companies ?? [];
    const subs = subscriptions ?? [];
    const stats = {
      total: all.length,
      ativas: all.filter((c: any) => c.status_cobranca === "ativo" || c.status_cobranca === "vitalicio").length,
      trial: all.filter((c: any) => c.status_cobranca === "trial").length,
      suspensas: all.filter((c: any) => c.status_cobranca === "suspenso").length,
      novasMes: all.filter((c: any) => new Date(c.created_at).getTime() >= monthStart).length,
      mensagens: msgCount ?? 0,
      cards: cardsCount ?? 0,
      assinaturasAtivas: subs.filter((s: any) => s.status === "active").length,
      assinaturasTrial: subs.filter((s: any) => s.status === "trialing").length,
      mrr: subs.filter((s: any) => s.status === "active").reduce((sum: number, s: any) => sum + (s.plan?.preco_cents ?? 0), 0),
    };
    // Crescimento (últimos 12 meses)
    const series: { mes: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = all.filter((c: any) => {
        const t = new Date(c.created_at).getTime();
        return t < next.getTime();
      }).length;
      series.push({ mes: d.toLocaleDateString("pt-BR", { month: "short" }), total: count });
    }
    return { stats, series };
  });

export const listMasterSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("subscription")
      .select("*, plan:plan(nome,preco_cents,moeda,intervalo), company:company(nome,status_cobranca,email_corporativo)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { rows: data ?? [] };
  });

export const listCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; page?: number }) => ({
    search: (d.search ?? "").trim().toLowerCase(),
    page: Math.max(0, d.page ?? 0),
  }))
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pageSize = 20;
    let q = supabaseAdmin
      .from("company")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
    if (data.search) q = q.ilike("nome", `%${data.search}%`);
    const { data: rows, count, error } = await q;
    if (error) throw error;
    const ids = (rows ?? []).map((c: any) => c.id);
    let ultByCompany: Record<string, string> = {};
    if (ids.length) {
      const { data: msgs } = await supabaseAdmin
        .from("mensagens")
        .select("company_id, created_at")
        .in("company_id", ids)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const m of msgs ?? []) {
        if (!ultByCompany[(m as any).company_id]) ultByCompany[(m as any).company_id] = (m as any).created_at;
      }
    }
    const list = (rows ?? []).map((c: any) => ({ ...c, ultima_atividade: ultByCompany[c.id] ?? null }));
    return { rows: list, total: count ?? 0, pageSize };
  });

export const suspendCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; suspend: boolean }) => d)
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("company")
      .update({ status_cobranca: data.suspend ? "suspenso" : "ativo" })
      .eq("id", data.companyId);
    if (error) throw error;
    return { ok: true };
  });

export const setCompanyLifetime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; lifetime: boolean; planSlug?: string }) => d)
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const farFuture = "2099-12-31T23:59:59.000Z";
    if (data.lifetime) {
      const slug = ["starter", "pro", "business"].includes(String(data.planSlug || "").toLowerCase())
        ? String(data.planSlug).toLowerCase()
        : "business";
      const { error } = await supabaseAdmin
        .from("company")
        .update({ status_cobranca: "vitalicio", trial_ate: farFuture, plano_vitalicio: slug })
        .eq("id", data.companyId);
      if (error) throw error;
      await supabaseAdmin
        .from("subscription")
        .update({ status: "active", current_period_end: farFuture })
        .eq("company_id", data.companyId);
    } else {
      const { error } = await supabaseAdmin
        .from("company")
        .update({ status_cobranca: "ativo" })
        .eq("id", data.companyId);
      if (error) throw error;
    }
    return { ok: true };
  });

export const extendTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; days: number }) => ({
    companyId: d.companyId,
    days: Math.max(1, Math.min(365, Math.floor(d.days))),
  }))
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("company").select("trial_ate").eq("id", data.companyId).maybeSingle();
    const base = c?.trial_ate ? new Date(c.trial_ate as string) : new Date();
    const next = new Date(Math.max(base.getTime(), Date.now()) + data.days * 86400000);
    const { error } = await supabaseAdmin
      .from("company")
      .update({ trial_ate: next.toISOString(), status_cobranca: "trial" })
      .eq("id", data.companyId);
    if (error) throw error;
    return { trial_ate: next.toISOString() };
  });

export const setCompanyInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; instanceName: string; apiKey?: string }) => d)
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nome = (data.instanceName || "").trim();
    if (!nome) throw new Error("Nome da instância é obrigatório");
    const key = (data.apiKey || "").trim();
    const { data: existing } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (existing) {
      const patch: any = { instance_name: nome };
      if (key) patch.api_key = key;
      const { error } = await supabaseAdmin
        .from("whatsapp_instances")
        .update(patch)
        .eq("company_id", data.companyId);
      if (error) throw error;
    } else {
      const { data: owner } = await supabaseAdmin
        .from("company_user")
        .select("user_id")
        .eq("company_id", data.companyId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();
      if (!owner) throw new Error("Empresa sem usuário responsável");
      const { error } = await supabaseAdmin.from("whatsapp_instances").insert({
        company_id: data.companyId,
        user_id: (owner as any).user_id,
        instance_name: nome,
        api_key: key || null,
        status: "disconnected",
        webhook_token: crypto.randomUUID(),
      } as any);
      if (error) throw error;
    }
    return { ok: true };
  });

export const createCompanyWithOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    nome: string; ownerEmail: string;
    planId?: string | null; trialDays?: number; password?: string | null;
  }) => {
    const nome = String(d.nome || "").trim();
    const ownerEmail = String(d.ownerEmail || "").trim().toLowerCase();
    if (nome.length < 2) throw new Error("Nome inválido");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("Email inválido");
    const password = d.password ? String(d.password) : null;
    if (password && password.length < 8) throw new Error("Senha mínima de 8 caracteres");
    return {
      nome, ownerEmail,
      planId: d.planId || null,
      trialDays: Math.max(0, Math.min(90, Math.floor(d.trialDays ?? 3))),
      password,
    };
  })
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // owner
    let ownerId: string | null = null;
    const { data: prof } = await supabaseAdmin.from("profiles").select("user_id").eq("email", data.ownerEmail).maybeSingle();
    if (prof) ownerId = prof.user_id;
    let tempPassword: string | null = null;
    if (!ownerId) {
      tempPassword = data.password ?? (Math.random().toString(36).slice(2, 10) + "A1!");
      const { data: c, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.ownerEmail, password: tempPassword, email_confirm: true,
      });
      if (error || !c.user) throw new Error(error?.message || "Falha ao criar usuário");
      ownerId = c.user.id;
      await supabaseAdmin.from("profiles").upsert({ user_id: ownerId, email: data.ownerEmail });
    } else if (data.password) {
      // Reset de senha do owner já existente
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(ownerId, {
        password: data.password, email_confirm: true,
      });
      if (upErr) throw upErr;
      tempPassword = data.password;
    }

    // company com slug único
    let baseSlug = slugify(data.nome);
    let slug = baseSlug;
    for (let i = 1; i < 20; i++) {
      const { data: ex } = await supabaseAdmin.from("company").select("id").eq("slug", slug).maybeSingle();
      if (!ex) break;
      slug = `${baseSlug}-${i}`;
    }
    const trialMs = data.trialDays * 86400000;
    const trialEnd = new Date(Date.now() + trialMs).toISOString();
    const { data: comp, error: cErr } = await supabaseAdmin
      .from("company")
      .insert({
        nome: data.nome,
        slug,
        created_by: ownerId,
        status_cobranca: data.trialDays > 0 ? "trial" : "ativo",
        trial_ate: trialEnd,
      })
      .select("id")
      .single();
    if (cErr || !comp) throw new Error(cErr?.message || "Falha ao criar empresa");

    await supabaseAdmin.from("company_user").insert({
      company_id: comp.id, user_id: ownerId, role: "owner", ativo: true, forcar_troca_senha: !data.password && !!tempPassword,
    });

    // Cria subscription em trialing já com o plano selecionado
    if (data.planId) {
      await supabaseAdmin.from("subscription").insert({
        company_id: comp.id,
        plan_id: data.planId,
        status: data.trialDays > 0 ? "trialing" : "active",
        trial_ends_at: trialEnd,
        current_period_end: trialEnd,
      });
    }

    return { ok: true, companyId: comp.id, tempPassword };
  });

export const listPlansBasic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("plan")
      .select("id, nome, preco_cents, moeda, intervalo, trial_days")
      .eq("ativo", true)
      .order("preco_cents", { ascending: true });
    return { plans: data ?? [] };
  });

export const getSuperAdminEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_config").select("super_admin_emails").eq("id", true).maybeSingle();
    return { emails: (data?.super_admin_emails ?? []) as string[] };
  });

export const setSuperAdminEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { emails: string[] }) => {
    const clean = Array.from(new Set((d.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)));
    for (const e of clean) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`Email inválido: ${e}`);
    }
    return { emails: clean };
  })
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ id: true, super_admin_emails: data.emails });
    if (error) throw error;
    // promove novos super_admin existentes
    if (data.emails.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("user_id, email").in("email", data.emails);
      for (const p of profs ?? []) {
        await supabaseAdmin.from("user_roles").upsert(
          { user_id: p.user_id, role: "super_admin" as any },
          { onConflict: "user_id,role" } as any,
        );
      }
    }
    return { ok: true };
  });

export const resetCompanyOwnerPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; newPassword?: string }) => ({
    companyId: String(d.companyId),
    newPassword: d.newPassword ? String(d.newPassword) : undefined,
  }))
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Descobre o owner ativo
    const { data: cu } = await supabaseAdmin
      .from("company_user")
      .select("user_id, role")
      .eq("company_id", data.companyId)
      .eq("ativo", true)
      .order("created_at", { ascending: true });
    const owner = (cu ?? []).find((r: any) => r.role === "owner") ?? (cu ?? [])[0];
    if (!owner) throw new Error("Empresa sem usuário responsável");

    const password =
      data.newPassword && data.newPassword.length >= 8
        ? data.newPassword
        : Math.random().toString(36).slice(2, 10) + "A1!";

    const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(owner.user_id, {
      password,
      email_confirm: true,
    });
    if (uErr) throw uErr;

    // Força troca no próximo login (se foi senha auto-gerada)
    if (!data.newPassword) {
      await supabaseAdmin
        .from("company_user")
        .update({ forcar_troca_senha: true })
        .eq("company_id", data.companyId)
        .eq("user_id", owner.user_id);
    }

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("user_id", owner.user_id)
      .maybeSingle();

    return { ok: true, tempPassword: data.newPassword ? null : password, ownerEmail: prof?.email ?? null };
  });

export const getCompanyDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string }) => ({ companyId: String(d.companyId) }))
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: company, error } = await supabaseAdmin
      .from("company")
      .select("*")
      .eq("id", data.companyId)
      .maybeSingle();
    if (error) throw error;
    if (!company) throw new Error("Empresa não encontrada");

    const { data: members } = await supabaseAdmin
      .from("company_user")
      .select("user_id, role, ativo, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: true });

    const userIds = (members ?? []).map((m: any) => m.user_id);
    let profilesById: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("user_id, email, nome, telefone")
        .in("user_id", userIds);
      for (const p of profs ?? []) profilesById[(p as any).user_id] = p;
    }
    const membersFull = (members ?? []).map((m: any) => ({
      ...m,
      profile: profilesById[m.user_id] ?? null,
    }));

    const { data: subscription } = await supabaseAdmin
      .from("subscription")
      .select("*, plan:plan(nome, preco_cents, moeda, intervalo)")
      .eq("company_id", data.companyId)
      .maybeSingle();

    const [{ count: msgCount }, { count: contactsCount }, { count: cardsCount }] = await Promise.all([
      supabaseAdmin.from("mensagens").select("id", { count: "exact", head: true }).eq("company_id", data.companyId),
      supabaseAdmin.from("crm_cards").select("id", { count: "exact", head: true }).eq("company_id", data.companyId),
      supabaseAdmin.from("crm_cards").select("id", { count: "exact", head: true }).eq("company_id", data.companyId),
    ]);

    const { data: instRow } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("instance_name, status, numero, api_key")
      .eq("company_id", data.companyId)
      .maybeSingle();
    const instance = instRow
      ? {
          instance_name: (instRow as any).instance_name,
          status: (instRow as any).status,
          numero: (instRow as any).numero,
          has_key: !!(instRow as any).api_key,
        }
      : null;

    return {
      company,
      members: membersFull,
      subscription,
      instance,
      stats: {
        mensagens: msgCount ?? 0,
        contatos: contactsCount ?? 0,
        cards: cardsCount ?? 0,
      },
    };
  });

export const getSystemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
      const t0 = Date.now();
      try {
        return { ms: Date.now() - t0, value: await fn() };
      } catch (e: any) {
        return { ms: Date.now() - t0, error: e?.name === "AbortError" ? "tempo esgotado" : e?.message || "erro" };
      }
    }
    async function fetchT(url: string, init: RequestInit = {}, ms = 8000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      try {
        return await fetch(url, { ...init, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    }
    const { getPlatformConfig } = await import("@/lib/platform-config.server");
    const pcfg = await getPlatformConfig();

    // --- IA da plataforma ---
    const geminiKey = pcfg.geminiKey.trim();
    const gatewayKey = process.env.LOVABLE_API_KEY?.trim();
    let ia: any;
    if (geminiKey) {
      const r = await timed(async () => {
        const gh: Record<string, string> = {};
        gh[["x-goog-api", "key"].join("-")] = geminiKey;
        const res = await fetchT("https://generativelanguage.googleapis.com/v1beta/models", { headers: gh });
        const j: any = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
        return j;
      });
      ia = r.error
        ? { mode: "propria", ok: false, warn: false, detail: `Chave Gemini da plataforma configurada, mas o Google recusou: ${r.error}`, latencyMs: r.ms }
        : { mode: "propria", ok: true, warn: false, detail: "Chave Gemini da plataforma ativa e respondendo (Google).", latencyMs: r.ms };
    } else if (gatewayKey) {
      ia = { mode: "gateway", ok: true, warn: true, detail: "Sem chave Gemini própria: a IA está usando o gateway da Lovable (cota do workspace)." };
    } else {
      ia = { mode: "off", ok: false, warn: false, detail: "Nenhuma chave de IA configurada (nem GEMINI_API_KEY, nem gateway)." };
    }

    // --- Evolution / servidor do WhatsApp ---
    const evoUrl = pcfg.evolutionUrl;
    const evoKey = pcfg.evolutionKey.trim();
    let evolution: any;
    if (!evoUrl) {
      evolution = { configured: false, online: false, keyStatus: "ausente", detail: "URL da Evolution não configurada (nem no sistema, nem nos segredos)." };
    } else {
      const root = await timed(async () => {
        const res = await fetchT(`${evoUrl}/`);
        const j: any = await res.json().catch(() => null);
        if (!res.ok && !j) throw new Error(`HTTP ${res.status}`);
        return j;
      });
      const online = !root.error;
      const version = (root.value as any)?.version;
      let keyStatus = "ausente";
      let instances: number | undefined;
      let keyDetail = "Chave da Evolution não configurada.";
      if (evoKey) {
        const r = await timed(async () => {
          const hdrs: Record<string, string> = {};
          hdrs[["api", "key"].join("")] = evoKey;
          const res = await fetchT(`${evoUrl}/instance/fetchInstances`, { headers: hdrs });
          const j: any = await res.json().catch(() => null);
          return { status: res.status, j };
        });
        if (r.value) {
          if (r.value.status === 200) {
            keyStatus = "global_ok";
            instances = Array.isArray(r.value.j) ? r.value.j.length : undefined;
            keyDetail = "Chave global válida: o DZap cria instâncias automaticamente.";
          } else if (r.value.status === 403) {
            keyStatus = "sem_permissao";
            keyDetail = "A chave salva não é a global: o DZap está no modo de instâncias pré-criadas (token por instância).";
          } else if (r.value.status === 401) {
            keyStatus = "invalida";
            keyDetail = "A chave salva foi recusada pelo servidor (401).";
          } else {
            keyStatus = "erro";
            keyDetail = `Resposta inesperada do servidor ao testar a chave (HTTP ${r.value.status}).`;
          }
        } else {
          keyDetail = "Não foi possível testar a chave (servidor inacessível).";
        }
      }
      evolution = {
        configured: true,
        online,
        version,
        keyStatus,
        instances,
        detail: online
          ? `Servidor Evolution online${version ? ` (v${version})` : ""}. ${keyDetail}`
          : "Servidor Evolution inacessível a partir da plataforma.",
      };
    }

    // --- Banco de dados + conexões WhatsApp ---
    const dbR = await timed(async () => {
      const [{ count: companies }, { data: insts }] = await Promise.all([
        supabaseAdmin.from("company").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("whatsapp_instances").select("status"),
      ]);
      const list = insts ?? [];
      return {
        companies: companies ?? 0,
        waTotal: list.length,
        waConnected: list.filter((i: any) => i.status === "connected").length,
      };
    });
    const database = dbR.error
      ? { ok: false, warn: false, detail: `Banco sem resposta (${dbR.error}).` }
      : { ok: true, warn: false, detail: `Banco respondendo — ${dbR.value!.companies} empresas cadastradas.`, latencyMs: dbR.ms };
    const whatsapp = dbR.error
      ? { total: 0, connected: 0, detail: "Não foi possível ler as conexões." }
      : {
          total: dbR.value!.waTotal,
          connected: dbR.value!.waConnected,
          detail:
            dbR.value!.waTotal === 0
              ? "Nenhuma instância de WhatsApp cadastrada."
              : `${dbR.value!.waConnected} de ${dbR.value!.waTotal} instâncias conectadas.`,
        };

    return { checkedAt: new Date().toISOString(), ia, evolution, whatsapp, database };
  });

export const getPlatformIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.supabase, context.userId);
  const { getPlatformConfig } = await import("@/lib/platform-config.server");
    const cfg = await getPlatformConfig();
    const hint = (v: string) => (v ? `•••• ${v.slice(-4)}` : "");
    return {
      evolutionUrl: { value: cfg.evolutionUrl, source: cfg.sources.evolutionUrl },
      evolutionKey: { configured: !!cfg.evolutionKey, hint: hint(cfg.evolutionKey), source: cfg.sources.evolutionKey },
      geminiKey: { configured: !!cfg.geminiKey, hint: hint(cfg.geminiKey), source: cfg.sources.geminiKey },
      googleClientId: { value: cfg.googleClientId, source: cfg.sources.googleClientId },
      googleClientSecret: { configured: !!cfg.googleClientSecret, hint: hint(cfg.googleClientSecret), source: cfg.sources.googleClientSecret },
    };
  });

const INTEGRATION_FIELDS = ["evolution_api_url", "evolution_api_key", "gemini_api_key", "google_client_id", "google_client_secret"] as const;

export const setPlatformIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    evolution_api_url?: string;
    evolution_api_key?: string;
    gemini_api_key?: string;
    google_client_id?: string;
    google_client_secret?: string;
    clear?: string[];
  }) => d)
  .handler(async ({ context, data }) => {
    await assertSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, string> = {};
    for (const f of INTEGRATION_FIELDS) {
      const v = (data as any)?.[f];
      if (typeof v === "string" && v.trim()) patch[f] = v.trim();
    }
    for (const f of data?.clear ?? []) {
      if ((INTEGRATION_FIELDS as readonly string[]).includes(f)) patch[f] = "";
    }
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin
        .from("app_config")
        .update({ ...patch, updated_at: new Date().toISOString() } as any)
        .eq("id", true);
      if (error) throw error;
    }
    const { clearPlatformConfigCache } = await import("@/lib/platform-config.server");
    clearPlatformConfigCache();
    return { ok: true as const };
  });
