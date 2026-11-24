import { createFileRoute } from "@tanstack/react-router";

// POST /api/public/voice/book
// Body: { company_id | phone_number, datetime (ISO com fuso), name,
//         phone, service, duration_min? }
// Cria o evento no Google Agenda da empresa com a MESMA reconferência
// de conflito do fluxo de WhatsApp (isSlotBusy antes de criar).
// Horário ocupado → 409 { ok:false, error:"horario_ocupado" }.
// Auth: header Authorization: Bearer <voice_api_token> (ou x-voice-token).

export const Route = createFileRoute("/api/public/voice/book")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { voiceAuthError, resolveVoiceConfig, getVoiceCompanyConfig } = await import(
          "@/lib/voice.server"
        );
        const authErr = await voiceAuthError(request);
        if (authErr) return authErr;

        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const datetime: string = String(body?.datetime || body?.start || "");
        const name: string = String(body?.name || body?.clientName || "").trim();
        const phone: string = String(body?.phone || "").trim();
        const service: string = String(body?.service || "").trim();
        const start = new Date(datetime);
        if (!datetime || Number.isNaN(start.getTime())) {
          return Response.json(
            { ok: false, error: "datetime inválido (esperado ISO com fuso)" },
            { status: 400 },
          );
        }
        if (!name || !service) {
          return Response.json(
            { ok: false, error: "name e service são obrigatórios" },
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
          return Response.json({ ok: false, error: "empresa não encontrada" }, { status: 404 });
        }
        const cfg = await getVoiceCompanyConfig(admin, voiceCfg);
        if (!cfg?.scheduling_enabled) {
          return Response.json(
            { ok: false, error: "agendamento indisponível para esta empresa" },
            { status: 403 },
          );
        }

        const durationMin =
          Number(body?.duration_min || body?.durationMin) > 0
            ? Number(body?.duration_min || body?.durationMin)
            : cfg.duration_min;
        const end = new Date(start.getTime() + durationMin * 60_000);

        try {
          const { isSlotBusy, createCalendarEventForCompany } = await import(
            "@/lib/google.server"
          );
          // Reconferência anti duplo-agendamento (igual ao webhook do WhatsApp).
          const busy = await isSlotBusy(
            admin,
            cfg.company_id,
            start.toISOString(),
            end.toISOString(),
          );
          if (busy) {
            return Response.json(
              { ok: false, error: "horario_ocupado" },
              { status: 409 },
            );
          }
          const { eventId } = await createCalendarEventForCompany(admin, cfg.company_id, {
            titulo: `${service} — ${name}`,
            inicio: start.toISOString(),
            fim: end.toISOString(),
            descricao: `Agendado por telefone (voz) — ${name}${phone ? ` (${phone})` : ""}`,
          });
          return Response.json({ ok: true, event_id: eventId });
        } catch (e: any) {
          console.error("[voice.book]", e?.message);
          return Response.json(
            { ok: false, error: String(e?.message || e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
