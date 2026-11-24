import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, X, Save, Copy, CheckCircle2, AlertCircle, BookOpen, Zap } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { brand } from "@/config/brand";
import { getSuperAdminEmails, setSuperAdminEmails, getPlatformIntegrations, setPlatformIntegrations } from "@/lib/master.functions";
import { getBillingWebhookInfo, listRecentBillingEvents } from "@/lib/billing.functions";

export const Route = createFileRoute("/master/configuracoes")({
  head: () => ({ meta: [{ title: `${brand.name} — Master Config` }] }),
  component: ConfigPage,
});

function ConfigPage() {
  const get = useServerFn(getSuperAdminEmails);
  const set = useServerFn(setSuperAdminEmails);
  const getWebhooks = useServerFn(getBillingWebhookInfo);
  const getEvents = useServerFn(listRecentBillingEvents);
  const getInteg = useServerFn(getPlatformIntegrations);
  const setIntegFn = useServerFn(setPlatformIntegrations);
  const [integ, setInteg] = useState<any>(null);
  const [fEvoUrl, setFEvoUrl] = useState("");
  const [fEvoKey, setFEvoKey] = useState("");
  const [fGemini, setFGemini] = useState("");
  const [fGroq, setFGroq] = useState("");
  const [fGId, setFGId] = useState("");
  const [fGSecret, setFGSecret] = useState("");
  const [fVoice, setFVoice] = useState("");
  const [savingInteg, setSavingInteg] = useState(false);

  const [emails, setEmails] = useState<string[]>([]);
  const [novo, setNovo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tokens, setTokens] = useState<{ kiwify: string; cakto: string; perfectpay: string } | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    void (async () => {
      const [r, w, e, gi] = await Promise.allSettled([get(), getWebhooks(), getEvents(), getInteg()]);
      if (gi.status === "fulfilled") {
        setInteg(gi.value);
        setFEvoUrl(gi.value.evolutionUrl.value || "");
        setFGId(gi.value.googleClientId.value || "");
      } else toast.error(`Integrações: ${gi.reason?.message ?? gi.reason}`);
      if (r.status === "fulfilled") setEmails(r.value.emails);
      else toast.error(`Emails: ${r.reason?.message ?? r.reason}`);
      if (w.status === "fulfilled") setTokens(w.value);
      else toast.error(`Webhooks: ${w.reason?.message ?? w.reason}`);
      if (e.status === "fulfilled") setEvents(e.value);
      else toast.error(`Eventos: ${e.reason?.message ?? e.reason}`);
      setLoading(false);
    })();
  }, []);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = novo.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast.error("Email inválido");
    if (emails.includes(v)) return toast.message("Já está na lista");
    setEmails([...emails, v]);
    setNovo("");
  }

  async function save() {
    setSaving(true);
    try { await set({ data: { emails } }); toast.success("Salvo"); }
    catch (e: any) { toast.error(e?.message); }
    finally { setSaving(false); }
  }

  async function loadInteg() {
    const r = await getInteg();
    setInteg(r);
    setFEvoUrl(r.evolutionUrl.value || "");
    setFGId(r.googleClientId.value || "");
  }

  async function saveInteg() {
    setSavingInteg(true);
    try {
      const data: Record<string, string> = {};
      const put = (k: string, v: string) => { if (v.trim()) data[k] = v.trim(); };
      put("evolution_api_url", fEvoUrl);
      put("evolution_api_key", fEvoKey);
      put("gemini_api_key", fGemini);
      put("groq_api_key", fGroq);
      put("google_client_id", fGId);
      put("google_client_secret", fGSecret);
      put("voice_api_token", fVoice);
      await setIntegFn({ data });
      setFEvoKey("");
      setFGemini("");
      setFGroq("");
      setFGSecret("");
      setFVoice("");
      await loadInteg();
      toast.success("Integrações salvas");
    } catch (e: any) { toast.error(e?.message); }
    finally { setSavingInteg(false); }
  }

  async function clearInteg(field: string) {
    try {
      await setIntegFn({ data: { clear: [field] } });
      await loadInteg();
      toast.success("Removido do sistema — volta a valer o segredo da Lovable, se houver");
    } catch (e: any) { toast.error(e?.message); }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = (provider: "kiwify" | "cakto" | "perfectpay") =>
    tokens?.[provider]
      ? `${origin}/api/public/billing/webhook?provider=${provider}&token=${tokens[provider]}`
      : "";

  async function copy(s: string) {
    try { await navigator.clipboard.writeText(s); toast.success("Copiado"); }
    catch { toast.error("Não consegui copiar"); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Super admins, cobrança e integrações da plataforma.</p>
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Webhooks de cobrança</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Cole as URLs abaixo no painel do seu checkout. Cada venda aprovada libera o cliente
            automaticamente (vínculo pelo <b>e-mail do comprador</b>); cancelamento, reembolso ou chargeback
            suspendem a conta. Renovação reativa.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["purchase_approved", "subscription_renewed", "subscription_canceled", "refunded", "chargeback", "payment_failed"].map((e) => (
              <span key={e} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{e}</span>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid place-items-center py-6"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {(["kiwify", "cakto", "perfectpay"] as const).map((p) => (
              <div key={p} className="border rounded-md p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider">{p}</span>
                  {tokens?.[p] ? (
                    <Badge variant="secondary" className="text-[10px]">configurado</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">sem token</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input readOnly value={url(p) || "(defina o secret)"} className="font-mono text-[11px]" />
                  <Button size="sm" variant="outline" onClick={() => copy(url(p))} disabled={!url(p)}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Accordion type="single" collapsible className="border rounded-md">
          <AccordionItem value="howto" className="border-0">
            <AccordionTrigger className="px-3 py-2 text-sm font-semibold hover:no-underline">
              <span className="flex items-center gap-2"><BookOpen className="size-4" /> Como integrar passo a passo</span>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3 space-y-4 text-xs">
              <div>
                <div className="font-bold uppercase tracking-wider mb-1">Kiwify</div>
                <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                  <li>Painel Kiwify → <b>Apps</b> → <b>Webhooks</b> → <b>Nova URL</b>.</li>
                  <li>Cole a URL da Kiwify acima.</li>
                  <li>Marque os eventos: <code>compra aprovada</code>, <code>reembolso</code>, <code>chargeback</code>, <code>assinatura cancelada</code>, <code>assinatura renovada</code>.</li>
                  <li>Salve. Faça uma compra teste de R$1 para validar — ela deve aparecer em "Últimos eventos".</li>
                </ol>
              </div>
              <div>
                <div className="font-bold uppercase tracking-wider mb-1">Cakto</div>
                <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                  <li>Painel Cakto → <b>Configurações</b> → <b>Webhooks</b> → <b>Adicionar</b>.</li>
                  <li>Cole a URL da Cakto acima.</li>
                  <li>Selecione: <code>PURCHASE_APPROVED</code>, <code>SUBSCRIPTION_RENEWED</code>, <code>SUBSCRIPTION_CANCELED</code>, <code>REFUND</code>, <code>CHARGEBACK</code>.</li>
                  <li>Salve e dispare o teste pelo próprio painel.</li>
                </ol>
              </div>
              <div>
                <div className="font-bold uppercase tracking-wider mb-1">Perfectpay</div>
                <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                  <li>Painel Perfectpay → <b>Ferramentas</b> → <b>Postback (Webhook)</b>.</li>
                  <li>Cole a URL da Perfectpay acima nos campos de <b>Aprovado, Cancelado, Estornado, Chargeback, Renovação</b>.</li>
                  <li>Salve. Use o botão "Enviar teste" da Perfectpay.</li>
                </ol>
              </div>
              <div className="rounded-md border bg-muted/40 p-2.5">
                <b>Vínculo cliente → empresa:</b> usamos o e-mail do comprador. O cadastro do cliente no DZap precisa usar o
                <b> mesmo e-mail</b> da compra. Para identificar o plano, casamos pelo <code>slug</code> do plano ou pelo trecho final da
                <code>checkout_url</code> com o <code>product_id</code> recebido.
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="outras" className="border-0 border-t">
            <AccordionTrigger className="px-3 py-2 text-sm font-semibold hover:no-underline">
              <span className="flex items-center gap-2"><Zap className="size-4" /> Uso outro checkout (Hotmart, Eduzz, Hubla, Monetizze, Stripe…)</span>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3 text-xs text-muted-foreground space-y-2">
              <p>
                Hoje normalizamos nativamente <b>Kiwify, Cakto e Perfectpay</b> — são os 3 mais usados pelo nosso público.
                Para qualquer outra plataforma você tem 2 caminhos:
              </p>
              <ol className="list-decimal pl-4 space-y-1.5">
                <li>
                  <b>Bridge via Zapier / Make / n8n (5 min, sem código):</b> crie um Zap "Novo pagamento aprovado" no seu checkout →
                  ação <i>Webhooks → POST</i> apontando para a URL de qualquer um dos 3 provedores acima usando o token, enviando um JSON com
                  <code> customer.email</code>, <code>event</code> (ex: <code>purchase_approved</code>) e <code>product_id</code>.
                </li>
                <li>
                  <b>Liberação manual:</b> no <a className="underline" href="/master/empresas">Master → Empresas</a> você pode marcar uma empresa como
                  <b> ativa</b> e definir o plano sem depender do webhook.
                </li>
              </ol>
              <p>
                Precisa de integração nativa com outro gateway? Mande pedido — adicionamos novos normalizadores em ~1 dia útil.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>


        <div>
          <h3 className="text-sm font-semibold mb-2">Últimos eventos recebidos</h3>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum webhook recebido ainda.</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-xs border rounded-md px-2.5 py-1.5">
                  {e.processed && !e.error ? (
                    <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="size-3.5 text-amber-600 shrink-0" />
                  )}
                  <span className="font-mono text-[10px] uppercase">{e.provider}</span>
                  <span className="truncate">{e.event_type}</span>
                  <span className="text-muted-foreground truncate">{e.buyer_email || "—"}</span>
                  {e.error && <span className="text-amber-600 truncate ml-auto">{e.error}</span>}
                  <span className="text-muted-foreground ml-auto whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

            <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Integrações da plataforma</h2>
          <p className="text-xs text-muted-foreground mt-1">
            As chaves que fazem a plataforma funcionar (WhatsApp, IA e Google Agenda). O que você salvar
            aqui vale na hora e tem <b>prioridade</b> sobre os segredos da Lovable — que seguem como reserva
            pros campos que ficarem vazios aqui. Campos de chave nunca mostram o valor: só o final (••••).
            Deixe o campo em branco pra manter o valor atual.
          </p>
        </div>

        {loading || !integ ? (
          <div className="grid place-items-center py-6"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider">WhatsApp (Evolution)</div>
              <IntegRow label="URL do servidor" badge={integ.evolutionUrl.source} onClear={integ.evolutionUrl.source === "sistema" ? () => void clearInteg("evolution_api_url") : undefined}>
                <Input value={fEvoUrl} onChange={(e) => setFEvoUrl(e.target.value)} placeholder="https://..." className="font-mono text-[12px]" />
              </IntegRow>
              <IntegRow label="Chave global (API key)" badge={integ.evolutionKey.source} hint={integ.evolutionKey.hint} onClear={integ.evolutionKey.source === "sistema" ? () => void clearInteg("evolution_api_key") : undefined}>
                <Input type="password" value={fEvoKey} onChange={(e) => setFEvoKey(e.target.value)} placeholder="Nova chave (em branco = manter a atual)" className="font-mono text-[12px]" />
              </IntegRow>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider">IA da plataforma (Gemini)</div>
              <IntegRow label="Chave Gemini da plataforma" badge={integ.geminiKey.source} hint={integ.geminiKey.hint} onClear={integ.geminiKey.source === "sistema" ? () => void clearInteg("gemini_api_key") : undefined}>
                <Input type="password" value={fGemini} onChange={(e) => setFGemini(e.target.value)} placeholder="Nova chave AIza... (em branco = manter a atual)" className="font-mono text-[12px]" />
              </IntegRow>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider">Transcrição de áudio (Whisper · Groq)</div>
              <IntegRow label="Chave Groq (Whisper)" badge={integ.groqKey.source} hint={integ.groqKey.hint} onClear={integ.groqKey.source === "sistema" ? () => void clearInteg("groq_api_key") : undefined}>
                <Input type="password" value={fGroq} onChange={(e) => setFGroq(e.target.value)} placeholder="Nova chave gsk_... (em branco = manter a atual)" className="font-mono text-[12px]" />
              </IntegRow>
              <p className="text-[11px] text-muted-foreground">Transcreve os áudios que os clientes mandam no WhatsApp e a IA responde a partir da transcrição. Sem a chave, o áudio fica registrado na conversa, mas a IA não responde.</p>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider">Google Agenda (OAuth)</div>
              <IntegRow label="Client ID" badge={integ.googleClientId.source} onClear={integ.googleClientId.source === "sistema" ? () => void clearInteg("google_client_id") : undefined}>
                <Input value={fGId} onChange={(e) => setFGId(e.target.value)} placeholder="....apps.googleusercontent.com" className="font-mono text-[12px]" />
              </IntegRow>
              <IntegRow label="Client Secret" badge={integ.googleClientSecret.source} hint={integ.googleClientSecret.hint} onClear={integ.googleClientSecret.source === "sistema" ? () => void clearInteg("google_client_secret") : undefined}>
                <Input type="password" value={fGSecret} onChange={(e) => setFGSecret(e.target.value)} placeholder="Novo segredo (em branco = manter o atual)" className="font-mono text-[12px]" />
              </IntegRow>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider">Atendimento por voz (LiveKit)</div>
              <IntegRow label="Token da API de voz" badge={integ.voiceApiToken.source} hint={integ.voiceApiToken.hint} onClear={integ.voiceApiToken.source === "sistema" ? () => void clearInteg("voice_api_token") : undefined}>
                <Input type="password" value={fVoice} onChange={(e) => setFVoice(e.target.value)} placeholder="Novo token (em branco = manter o atual)" className="font-mono text-[12px]" />
              </IntegRow>
              <p className="text-[11px] text-muted-foreground">É o token que o agente de voz hospedado no LiveKit Cloud usa pra se autenticar nas rotas /api/public/voice/*. Precisa ser o MESMO valor configurado nos secrets do agente (DZAP_VOICE_TOKEN). Vazio = endpoints de voz desligados (503).</p>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void saveInteg()} disabled={savingInteg}>
                {savingInteg ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
                Salvar integrações
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">Emails de super admin</h2>
        <form onSubmit={add} className="flex gap-2">
          <Input placeholder="email@exemplo.com" value={novo} onChange={(e) => setNovo(e.target.value)} />
          <Button type="submit" variant="outline"><Plus className="size-4 mr-1" /> Adicionar</Button>
        </form>
        {loading ? (
          <div className="grid place-items-center py-6"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <ul className="space-y-2">
            {emails.length === 0 && <li className="text-sm text-muted-foreground">Nenhum email cadastrado.</li>}
            {emails.map((e) => (
              <li key={e} className="flex items-center justify-between border rounded-md px-3 py-2">
                <span className="text-sm">{e}</span>
                <button onClick={() => setEmails(emails.filter((x) => x !== e))} className="text-muted-foreground hover:text-destructive" title="Remover">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  );
}


function IntegRow({ label, badge, hint, onClear, children }: { label: string; badge: string; hint?: string; onClear?: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium">{label}</span>
        {badge === "sistema" && <Badge variant="secondary" className="text-[10px]">salvo no sistema</Badge>}
        {badge === "ambiente" && <Badge variant="outline" className="text-[10px]">segredo da Lovable</Badge>}
        {badge === "vazio" && <Badge variant="destructive" className="text-[10px]">não configurado</Badge>}
        {hint && <span className="text-[11px] text-muted-foreground font-mono">{hint}</span>}
        {onClear && (
          <button onClick={onClear} className="ml-auto text-[11px] text-muted-foreground hover:text-destructive underline underline-offset-2">
            remover do sistema
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
