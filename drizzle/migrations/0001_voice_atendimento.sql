-- Atendimento por VOZ (LiveKit + Gemini Live) — implantação fase backend.
-- Aplicar no SQL Editor do Lovable Cloud (Supabase), igual às demais
-- alterações de schema do projeto (ex.: groq_api_key em app_config).
-- Depois de aplicar, regenere os tipos (src/integrations/supabase/types.ts)
-- se quiser tipar voice_config/voice_api_token no front.

-- 1) Token global que o worker de voz (LiveKit Cloud) usa para autenticar
--    nas rotas /api/public/voice/*. Mesmo padrão das outras integrações da
--    plataforma em app_config (evolution_api_key, gemini_api_key, ...).
--    Vazio = endpoints de voz respondem 503 (recurso desligado).
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS voice_api_token text NOT NULL DEFAULT '';

-- 2) Configuração de voz por empresa — tabela própria, seguindo o padrão
--    das integrações por empresa do projeto (google_integration,
--    whatsapp_instances): 1 linha por empresa, PK = company_id.
CREATE TABLE IF NOT EXISTS public.voice_config (
  company_id   uuid PRIMARY KEY REFERENCES public.company(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  -- Número de telefone (DID Telnyx) que atende por esta empresa.
  -- Guardar só dígitos, com DDI (ex.: 553335511254). É por este número
  -- que o worker descobre a empresa dona da ligação.
  phone_number text NOT NULL DEFAULT '',
  -- Saudação inicial falada pela agente (vazio = usa agent_config.apresentacao
  -- ou a saudação padrão montada pelo backend).
  greeting     text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Um número só pode pertencer a uma empresa.
CREATE UNIQUE INDEX IF NOT EXISTS voice_config_phone_number_uidx
  ON public.voice_config (phone_number)
  WHERE phone_number <> '';

-- Acesso somente via service_role (backend), como nas demais tabelas
-- internas: RLS ligado e nenhuma policy pública.
ALTER TABLE public.voice_config ENABLE ROW LEVEL SECURITY;
