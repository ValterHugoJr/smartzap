// Multi-provider AI chat. Gemini default via Lovable Gateway (free for users).

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type AiProviderConfig = {
  provider: "gemini" | "openai" | "anthropic";
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
};

// Valor de agent_config.ai_provider vem do banco: só aceita os três provedores
// conhecidos; qualquer outro valor cai no padrão (gemini) em vez de vazar pro Gateway.
export function normalizeAiProvider(value: unknown): AiProviderConfig["provider"] {
  return value === "openai" || value === "anthropic" || value === "gemini" ? value : "gemini";
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function aiChat(cfg: AiProviderConfig, messages: ChatMsg[]): Promise<string> {
  const provider = cfg.provider || "gemini";
  if (provider === "openai") {
    const key = cfg.openaiKey?.trim();
    if (!key) throw new Error("Chave OpenAI não configurada na sua empresa.");
    const model = cfg.model || "gpt-4o-mini";
    return openAiChat(key, model, messages);
  }
  if (provider === "anthropic") {
    const key = cfg.anthropicKey?.trim();
    if (!key) throw new Error("Chave Anthropic (Claude) não configurada na sua empresa.");
    const model = cfg.model || "claude-3-5-sonnet-latest";
    return anthropicChat(key, model, messages);
  }
  // Gemini com a chave da própria empresa (direto no Google, sem gateway)
  const ownKey = cfg.geminiKey?.trim();
  if (ownKey) return googleDirectChat(ownKey, cfg.model || "google/gemini-2.5-flash", messages);
  // Chave Gemini da plataforma (conta do dono do sistema) — prioridade sobre o gateway
  const { getPlatformConfig } = await import("@/lib/platform-config.server");
  const platformKey = (await getPlatformConfig()).geminiKey.trim();
  if (platformKey) return googleDirectChat(platformKey, cfg.model || "google/gemini-2.5-flash", messages);
  // fallback: Gemini via Lovable Gateway
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY ausente.");
  const model = cfg.model || "google/gemini-2.5-flash";
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente em alguns minutos.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
    throw new Error(`Lovable AI: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.toString().trim() || "";
}

async function openAiChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.toString().trim() || "";
}

async function anthropicChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conv = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: conv }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const txt = (data?.content || [])
    .filter((p: any) => p?.type === "text")
    .map((p: any) => p.text)
    .join("\n")
    .trim();
  return txt;
}

async function googleDirectChatOnce(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  let directModel = model.replace(/^google\//, "");
  // O gemini-2.5-flash foi encerrado pra contas novas (404 do Google);
  // qualquer variação 2.5 cai pro modelo atual sugerido pelo Google.
  if (directModel.startsWith("gemini-2.5")) directModel = "gemini-3.8-flash";
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: directModel, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Limite de uso da sua chave Gemini atingido. Tente em alguns minutos.");
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error("Chave Gemini inválida ou sem permissão. Confira a chave salva nas configurações do agente.");
    }
    throw new Error(`Gemini (chave própria): ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.toString().trim() || "";
}

// Compatibilidade: os chamadores (webhook, teste de IA e montagem do agente)
// usam lovableAiChat(messages, config) — esta função adapta pra aiChat.
export async function lovableAiChat(
  messages: ChatMsg[],
  modelOrConfig: string | AiProviderConfig = "google/gemini-2.5-flash",
): Promise<string> {
  const cfg: AiProviderConfig =
    typeof modelOrConfig === "string"
      ? { provider: "gemini", model: modelOrConfig }
      : {
          provider: (modelOrConfig?.provider as AiProviderConfig["provider"]) || "gemini",
          model: modelOrConfig?.model,
          openaiKey: modelOrConfig?.openaiKey,
          anthropicKey: modelOrConfig?.anthropicKey,
          geminiKey: modelOrConfig?.geminiKey,
        };
  return aiChat(cfg, messages);
}

// Chamada direta ao Google com resiliência: se o modelo principal estiver
// congestionado (503) ou indisponível (404), tenta de novo e, persistindo,
// cai pro modelo reserva (flash-lite) — um pico do Google não pode travar
// o atendimento nem a montagem do agente.
async function googleDirectChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const base = model.replace(/^google\//, "");
  const primary = base.startsWith("gemini-2.5") ? "gemini-3.8-flash" : base;
  const candidates = primary === "gemini-3.5-flash-lite" ? [primary] : [primary, "gemini-3.5-flash-lite"];
  let lastError: unknown = null;
  for (const cand of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await googleDirectChatOnce(key, cand, messages);
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || "");
        if (/503|UNAVAILABLE|high demand/i.test(msg)) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          break;
        }
        if (/404/.test(msg)) break;
        throw e;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
