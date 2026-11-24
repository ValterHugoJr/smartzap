import { createFileRoute } from "@tanstack/react-router";

// GET/POST /api/public/voice/config
// O worker de voz (LiveKit Cloud) chama com o número chamado (DID) e
// recebe a configuração da empresa dona daquele número: identidade do
// agente, saudação, se o agendamento está ativo (config + plano +
// Google conectado) e fuso. Sem empresa pro número → 404.
// Auth: header Authorization: Bearer <voice_api_token> (ou x-voice-token).

async function handle(request: Request, phoneRaw: string | null, companyId: string | null) {
  const { voiceAuthError, resolveVoiceConfig, getVoiceCompanyConfig } = await import(
    "@/lib/voice.server"
  );
  const authErr = await voiceAuthError(request);
  if (authErr) return authErr;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const voiceCfg = await resolveVoiceConfig(supabaseAdmin as any, {
    company_id: companyId,
    phone_number: phoneRaw,
  });
  if (!voiceCfg) {
    return Response.json(
      { ok: false, error: "nenhuma empresa encontrada para este número" },
      { status: 404 },
    );
  }
  const cfg = await getVoiceCompanyConfig(supabaseAdmin as any, voiceCfg);
  if (!cfg) {
    return Response.json({ ok: false, error: "empresa sem configuração" }, { status: 404 });
  }
  return Response.json({ ok: true, ...cfg });
}

export const Route = createFileRoute("/api/public/voice/config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return handle(
          request,
          url.searchParams.get("phone_number") || url.searchParams.get("phone"),
          url.searchParams.get("company_id"),
        );
      },
      POST: async ({ request }) => {
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        return handle(
          request,
          body?.phone_number || body?.phone || null,
          body?.company_id || body?.companyId || null,
        );
      },
    },
  },
});
