// SERVER ONLY. Backend do atendimento por VOZ (LiveKit + Gemini Live).
//
// O worker de voz roda FORA do Lovable (LiveKit Cloud) e fala com o DZap
// por estas rotas públicas: /api/public/voice/config|availability|book.
// Autenticação: header "Authorization: Bearer <token>" ou "x-voice-token",
// comparado com app_config.voice_api_token (tela Master → Integrações,
// mesmo padrão de platform-config.server.ts: banco tem prioridade,
// vazio cai pro segredo de ambiente VOICE_API_TOKEN).
// Token vazio no banco E no ambiente = recurso desligado (503).

let tokenCache: { at: number; token: string } | null = null;
const TOKEN_TTL_MS = 30_000;

export async function getVoiceApiToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.token;
  let token = "";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // select("*") + any: a coluna voice_api_token entra no banco pela
    // migração 0001 antes de os tipos gerados serem atualizados
    // (mesmo caso do groq_api_key em platform-config.server.ts).
    const { data } = await (supabaseAdmin as any)
      .from("app_config")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    token = typeof (data as any)?.voice_api_token === "string" ? (data as any).voice_api_token.trim() : "";
  } catch {}
  if (!token) token = (process.env.VOICE_API_TOKEN || "").trim();
  tokenCache = { at: Date.now(), token };
  return token;
}

// Retorna uma Response de erro se a autenticação falhar, ou null se OK.
export async function voiceAuthError(request: Request): Promise<Response | null> {
  const expected = await getVoiceApiToken();
  if (!expected) {
    return Response.json(
      { ok: false, error: "voice_api_token não configurado (recurso de voz desligado)" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") || "";
  const supplied =
    request.headers.get("x-voice-token") ||
    (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "");
  if (!supplied || supplied !== expected) {
    return Response.json({ ok: false, error: "token inválido" }, { status: 401 });
  }
  return null;
}

// ---------------------------------------------------------------- telefones

// Só dígitos (com DDI quando houver). Ex.: "+55 (33) 3551-1254" → "553335511254".
export function normalizePhone(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

// Chave de comparação: últimos 11 dígitos (DDD + número BR), tolerando
// o número gravado com ou sem o 55.
function phoneKey(digits: string): string {
  return digits.length > 11 ? digits.slice(-11) : digits;
}

// ------------------------------------------------------------------ empresa

export type VoiceCompanyRef = { company_id?: string | null; phone_number?: string | null };

// Resolve a linha de voice_config a partir de company_id ou do número
// chamado (phone_number). Retorna null se nenhuma empresa casar.
export async function resolveVoiceConfig(admin: any, ref: VoiceCompanyRef): Promise<any | null> {
  if (ref.company_id) {
    const { data } = await admin
      .from("voice_config")
      .select("*")
      .eq("company_id", ref.company_id)
      .maybeSingle();
    return data ?? null;
  }
  const digits = normalizePhone(ref.phone_number);
  if (!digits) return null;
  const { data: exact } = await admin
    .from("voice_config")
    .select("*")
    .eq("phone_number", digits)
    .maybeSingle();
  if (exact) return exact;
  // Fallback: compara pelos últimos 11 dígitos (gravado com/sem DDI).
  const { data: rows } = await admin
    .from("voice_config")
    .select("*")
    .neq("phone_number", "")
    .limit(500);
  const key = phoneKey(digits);
  return (rows ?? []).find((r: any) => phoneKey(normalizePhone(r.phone_number)) === key) ?? null;
}

// ------------------------------------------------------------ config da voz

export type VoiceCompanyConfig = {
  company_id: string;
  company_name: string;
  agent_name: string;
  greeting: string;
  voice_enabled: boolean;
  scheduling_enabled: boolean;
  plan: string;
  timezone: string;
  services: string;
  duration_min: number;
  instructions: string;
};

function parseDurationMinutes(raw: string | null | undefined): number {
  const s = String(raw || "").toLowerCase();
  const h = /(\d+(?:[.,]\d+)?)\s*h/.exec(s);
  if (h) return Math.round(parseFloat(h[1].replace(",", ".")) * 60);
  const m = /(\d+)\s*min/.exec(s);
  if (m) return parseInt(m[1], 10);
  const n = /(\d+)/.exec(s);
  if (n) return parseInt(n[1], 10);
  return 30;
}

function parseAntecedenciaMin(raw: string | null | undefined): number {
  const s = String(raw || "").toLowerCase();
  const h = /(\d+(?:[.,]\d+)?)\s*h/.exec(s);
  if (h) return Math.round(parseFloat(h[1].replace(",", ".")) * 60);
  const m = /(\d+)\s*min/.exec(s);
  if (m) return parseInt(m[1], 10);
  return 120; // padrão do prompt atual: "2 horas"
}

export async function getVoiceCompanyConfig(
  admin: any,
  voiceCfg: any,
): Promise<VoiceCompanyConfig | null> {
  const companyId = voiceCfg.company_id as string;
  const [{ data: cfg }, { data: comp }, { data: gi }] = await Promise.all([
    admin.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
    admin.from("company").select("nome").eq("id", companyId).maybeSingle(),
    admin.from("google_integration").select("conectado").eq("company_id", companyId).maybeSingle(),
  ]);
  if (!cfg && !comp) return null;

  const { getCompanyPlan } = await import("@/lib/plan-limits.server");
  const { featuresFor } = await import("@/lib/plan-features");
  const plan = await getCompanyPlan(companyId);

  const companyName = (cfg as any)?.nome_empresa || (comp as any)?.nome || "";
  const agentName = (cfg as any)?.nome_agente || "atendente";
  const schedulingEnabled =
    !!(cfg as any)?.agendamento_ativo &&
    featuresFor(plan.slug).googleCalendar &&
    !!(gi as any)?.conectado;

  const horas = ((cfg as any)?.horarios_atendimento ?? null) as any;
  const timezone = (horas?.timezone as string) || "America/Sao_Paulo";

  const greeting =
    (voiceCfg.greeting as string)?.trim() ||
    ((cfg as any)?.apresentacao as string)?.trim() ||
    `Olá! Aqui é ${agentName}, da ${companyName}. Como posso ajudar?`;

  // Instruções textuais da empresa (mesma base do agente de WhatsApp,
  // sem as regras de formatação de chat — quem monta a persona de voz
  // é o worker, a partir destes blocos).
  const blocos: Array<[string, any]> = [
    ["Papel e objetivo", (cfg as any)?.papel_objetivo],
    ["Sobre a empresa", (cfg as any)?.sobre_empresa],
    ["Produtos e serviços", (cfg as any)?.produtos_servicos],
    ["Serviços agendáveis", (cfg as any)?.servicos_agendaveis],
    ["O que você pode fazer", (cfg as any)?.pode_fazer],
    ["O que você NÃO pode fazer", (cfg as any)?.nao_pode_fazer],
    ["Formas de pagamento", (cfg as any)?.formas_pagamento],
    ["FAQ", (cfg as any)?.faq],
    ["Políticas", (cfg as any)?.politicas],
    ["Personalidade", (cfg as any)?.personalidade],
    ["Telefone de transferência para humano", (cfg as any)?.telefone_transferencia],
  ];
  const instructions = blocos
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([titulo, v]) => `${titulo}: ${String(v).trim()}`)
    .join("\n");

  return {
    company_id: companyId,
    company_name: companyName,
    agent_name: agentName,
    greeting,
    voice_enabled: !!voiceCfg.enabled,
    scheduling_enabled: schedulingEnabled,
    plan: plan.slug,
    timezone,
    services: ((cfg as any)?.servicos_agendaveis as string) || "",
    duration_min: parseDurationMinutes((cfg as any)?.duracao_padrao),
    instructions,
  };
}

// ------------------------------------------------------------- disponibilidade

// Converte uma data (AAAA-MM-DD) + hora (HH:MM) de parede no fuso `tz`
// para o instante UTC correspondente.
export function zonedTimeToUtc(dateStr: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(guess))) parts[p.type] = p.value;
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (wallAsUtc - guess));
}

export type FreeSlot = { label: string; start: string; end: string };

// Horários livres de um dia (AAAA-MM-DD) usando a MESMA lógica do
// WhatsApp: janela de atendimento (agent_config.horarios_atendimento,
// formato de business-hours.ts) menos os períodos ocupados reais do
// Google Agenda (listBusyPeriods), respeitando duração padrão e
// antecedência mínima configuradas.
export async function computeFreeSlots(
  admin: any,
  companyId: string,
  dateStr: string,
): Promise<{ timezone: string; duration_min: number; slots: FreeSlot[] }> {
  const { data: cfg } = await admin
    .from("agent_config")
    .select("horarios_atendimento, duracao_padrao, antecedencia_min")
    .eq("company_id", companyId)
    .maybeSingle();

  const { defaultHours } = await import("@/lib/business-hours");
  const horasCfg: any = (cfg as any)?.horarios_atendimento ?? null;
  const horas = horasCfg?.dias ? horasCfg : defaultHours();
  const timezone: string = horas?.timezone || "America/Sao_Paulo";
  const duration = parseDurationMinutes((cfg as any)?.duracao_padrao);
  const antecedencia = parseAntecedenciaMin((cfg as any)?.antecedencia_min);

  const [y, mo, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const day = horas?.dias?.[String(dow)] ?? null;
  if (!day?.abre || !day?.fecha) return { timezone, duration_min: duration, slots: [] };

  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const openMin = toMin(day.abre);
  const closeMin = toMin(day.fecha);
  if (closeMin <= openMin) return { timezone, duration_min: duration, slots: [] };

  const { listBusyPeriods } = await import("@/lib/google.server");
  const dayStart = zonedTimeToUtc(dateStr, "00:00", timezone);
  const dayEnd = zonedTimeToUtc(dateStr, "23:59", timezone);
  const busy = await listBusyPeriods(admin, companyId, dayStart.toISOString(), dayEnd.toISOString());

  const minStart = Date.now() + antecedencia * 60_000;
  const slots: FreeSlot[] = [];
  for (let t = openMin; t + duration <= closeMin; t += duration) {
    const hh = String(Math.floor(t / 60)).padStart(2, "0");
    const mm = String(t % 60).padStart(2, "0");
    const endHh = String(Math.floor((t + duration) / 60)).padStart(2, "0");
    const endMm = String((t + duration) % 60).padStart(2, "0");
    const start = zonedTimeToUtc(dateStr, `${hh}:${mm}`, timezone);
    const end = zonedTimeToUtc(dateStr, `${endHh}:${endMm}`, timezone);
    if (start.getTime() < minStart) continue;
    const overlaps = busy.some(
      (b) => new Date(b.inicio).getTime() < end.getTime() && new Date(b.fim).getTime() > start.getTime(),
    );
    if (overlaps) continue;
    slots.push({ label: `${hh}:${mm}`, start: start.toISOString(), end: end.toISOString() });
  }
  return { timezone, duration_min: duration, slots };
}
