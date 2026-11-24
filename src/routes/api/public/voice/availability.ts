import { createFileRoute } from "@tanstack/react-router";

// POST /api/public/voice/availability
// Body: { company_id | phone_number, date: "AAAA-MM-DD" }
// Devolve os horários livres do dia: janela de atendimento da empresa
// (agent_config.horarios_atendimento) menos os períodos ocupados reais
// do Google Agenda, com duração padrão e antecedência mínima da config.
// Auth: header Authorization: Bearer <voice_api_token> (ou x-voice-token).

export const Route = createFileRoute("/api/public/voice/availability")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { voiceAuthError, resolveVoiceConfig, getVoiceCompanyConfig, computeFreeSlots } =
          await import("@/lib/voice.server");
        const authErr = await voiceAuthError(request);
        if (authErr) return authErr;

        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const date: string = String(body?.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return Response.json(
            { ok: false, error: "date inválida (esperado AAAA-MM-DD)" },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;
        const voiceCfg = await resolveVoiceConfig(admin, {
          company_id: body?.company_id || body?.companyId || null,
          phone_number: body?.phone_number || body?.phone || null,
        });
        if (!voiceCfg) {
          return Response.json(
            { ok: false, error: "empresa não encontrada" },
            { status: 404 },
          );
        }
        const cfg = await getVoiceCompanyConfig(admin, voiceCfg);
        if (!cfg?.scheduling_enabled) {
          return Response.json({
            ok: true,
            scheduling_enabled: false,
            date,
            free: [],
            slots: [],
          });
        }
        try {
          const { timezone, duration_min, slots } = await computeFreeSlots(
            admin,
            cfg.company_id,
            date,
          );
          return Response.json({
            ok: true,
            scheduling_enabled: true,
            company_id: cfg.company_id,
            date,
            timezone,
            duration_min,
            // `free` = lista simples de "HH:MM" (formato que o worker fala);
            // `slots` traz início/fim ISO de cada horário.
            free: slots.map((s) => s.label),
            slots,
          });
        } catch (e: any) {
          console.error("[voice.availability]", e?.message);
          return Response.json(
            { ok: false, error: String(e?.message || e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
