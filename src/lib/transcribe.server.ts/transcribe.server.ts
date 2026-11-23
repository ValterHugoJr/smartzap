// Transcrição de áudios de clientes (WhatsApp) com o Whisper da Groq
// (modelo whisper-large-v3). A chave fica nas Integrações da plataforma
// (app_config.groq_api_key), com reserva pro segredo GROQ_API_KEY do
// ambiente. Devolve o texto transcrito ou null se não der pra transcrever.

export async function transcribeAudioGroq(base64: string, mimeType?: string): Promise<string | null> {
  try {
    const { getPlatformConfig } = await import("@/lib/platform-config.server");
    const cfg = await getPlatformConfig();
    const key = (cfg.groqKey || "").trim();
    if (!key) return null;

    const clean = (mimeType || "audio/ogg").split(";")[0].trim().toLowerCase();
    const ext = clean.includes("mpeg") ? "mp3"
      : clean.includes("mp4") ? "m4a"
      : clean.includes("wav") ? "wav"
      : clean.includes("webm") ? "webm"
      : "ogg";

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: clean || "audio/ogg" }), `audio.${ext}`);
    form.append("model", "whisper-large-v3");
    form.append("language", "pt");
    form.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      console.error("[transcribe] groq http", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data: any = await res.json().catch(() => null);
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return text || null;
  } catch (e: any) {
    console.error("[transcribe]", e?.message);
    return null;
  }
}
