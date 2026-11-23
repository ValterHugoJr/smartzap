import { createFileRoute, redirect } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listCampaigns, saveCampaign, deleteCampaign, startCampaign,
  pauseCampaign, cancelCampaign, listAvailableTags, previewAudience, getCampaign,
} from "@/lib/campaigns.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Play, Pause, Trash2, X, Megaphone, Users, Send, AlertCircle, Calendar } from "lucide-react";
import { brand } from "@/config/brand";

export const Route = createFileRoute("/app/campanhas")({
  head: () => ({ meta: [{ title: `${brand.name} — Campanhas` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: CampanhasPage,
});

const STATUS: Record<string, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  agendada: { label: "Agendada", cls: "bg-[rgba(124,58,237,.15)] text-[var(--brand-text)]" },
  enviando: { label: "Enviando", cls: "bg-amber-500/15 text-amber-600" },
  pausada: { label: "Pausada", cls: "bg-orange-500/15 text-orange-600" },
  concluida: { label: "Concluída", cls: "bg-emerald-500/15 text-emerald-600" },
  enviada: { label: "Enviada", cls: "bg-emerald-500/15 text-emerald-600" },
  parcial: { label: "Parcial", cls: "bg-amber-500/15 text-amber-600" },
  falhou: { label: "Falhou", cls: "bg-red-500/15 text-red-600" },
  cancelada: { label: "Cancelada", cls: "bg-red-500/15 text-red-600" },
};

function CampanhasPage() {
  const list = useServerFn(listCampaigns);
  const save = useServerFn(saveCampaign);
  const remove = useServerFn(deleteCampaign);
  const start = useServerFn(startCampaign);
  const pause = useServerFn(pauseCampaign);
  const cancel = useServerFn(cancelCampaign);
  const tagsFn = useServerFn(listAvailableTags);
  const previewFn = useServerFn(previewAudience);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [preview, setPreview] = useState<{ total: number; sample: any[] } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([list(), tagsFn()]);
      setRows(r as any[]); setTags(t as string[]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const id = setInterval(() => { void list().then((r) => setRows(r as any[])); }, 15_000);
    return () => clearInterval(id);
  }, []);

  function openNew() {
    setEditing({
      nome: "", mensagem: "", agendado_para: "", filtro_tags: [],
      intervalo_min_seg: 5, intervalo_max_seg: 20, pausa_apos_envios: 50, pausa_duracao_min: 10,
    });
    setPreview(null);
    setOpen(true);
  }

  async function calcPreview(currentTags: string[]) {
    try { setPreview(await previewFn({ data: { tags: currentTags } }) as any); }
    catch (e: any) { toast.error(e?.message ?? "Erro ao calcular público"); }
  }

  async function handleSave() {
    if (!editing?.nome?.trim() || !editing?.mensagem?.trim()) {
      toast.error("Nome e mensagem são obrigatórios"); return;
    }
    try {
      await save({ data: {
        id: editing.id,
        nome: editing.nome.trim(),
        mensagem: editing.mensagem,
        agendado_para: editing.agendado_para || null,
        filtro_tags: editing.filtro_tags ?? [],
        intervalo_min_seg: Number(editing.intervalo_min_seg) || 5,
        intervalo_max_seg: Number(editing.intervalo_max_seg) || 20,
        pausa_apos_envios: Number(editing.pausa_apos_envios) || 50,
        pausa_duracao_min: Number(editing.pausa_duracao_min) || 10,
      } });
      toast.success("Campanha salva");
      setOpen(false);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Erro ao salvar"); }
  }

  async function handleStart(id: string) {
    try {
      const r: any = await start({ data: { id } });
      toast.success(`${r.total} destinatários na fila`);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Erro ao iniciar"); }
  }

  const kpiEnviadas = rows.reduce((a, c) => a + (c.total_enviados || 0), 0);
  const kpiDestinatarios = rows.reduce((a, c) => a + (c.total_destinatarios || 0), 0);
  const kpiFalhas = rows.reduce((a, c) => a + (c.total_falhas || 0), 0);
  const kpiEmAndamento = rows.filter((c) => c.status === "enviando" || c.status === "agendada").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Megaphone className="size-6" /> Campanhas <HelpTip text="Disparos em massa segmentados (por etapa do CRM, tag, etc). Respeitam horário de envio e regras anti-ban para proteger o seu número." /></h1>
          <p className="text-sm text-muted-foreground">Envie mensagens em massa para seus contatos, com agendamento e anti-ban.</p>
        </div>
        <Button onClick={openNew}><Plus className="size-4 mr-1" /> Nova campanha</Button>
      </div>

      {rows.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 grid sm:grid-cols-4 gap-4">
          <Kpi icon={<Send className="size-3.5" />} label="Enviadas" value={String(kpiEnviadas)} />
          <Kpi icon={<Users className="size-3.5" />} label="Destinatários" value={String(kpiDestinatarios)} />
          <Kpi icon={<Megaphone className="size-3.5" />} label="Em andamento" value={String(kpiEmAndamento)} />
          <Kpi icon={<AlertCircle className="size-3.5" />} label="Falhas" value={String(kpiFalhas)} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <Megaphone className="size-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Nenhuma campanha ainda</p>
          <p className="text-sm text-muted-foreground mb-4">Crie sua primeira campanha para disparar mensagens em massa.</p>
          <Button onClick={openNew}><Plus className="size-4 mr-1" /> Criar campanha</Button>
        </Card>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Campanha</th>
                <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">Status</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Segmento</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Quando</th>
                <th className="text-right px-4 py-3 font-semibold">Entrega</th>
                <th className="text-right px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const pct = c.total_destinatarios ? Math.round((c.total_enviados / c.total_destinatarios) * 100) : 0;
                const st = STATUS[c.status] ?? { label: c.status, cls: "bg-muted text-muted-foreground" };
                const segmento = (c.filtro_tags ?? []).length > 0 ? `Tag: ${(c.filtro_tags as string[]).join(" · ")}` : "Todos os contatos";
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[13.5px]">{c.nome}</div>
                      <div className="text-[11px] text-muted-foreground sm:hidden">{st.label}</div>
                      <div className="text-[12px] text-muted-foreground line-clamp-1 max-w-[300px]">{c.mensagem}</div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge className={`${st.cls} border-none font-semibold`}>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-[12.5px]">{segmento}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-[12.5px]">
                      <Calendar className="size-3 inline mr-1" />
                      {new Date(c.agendado_para ?? c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-[12px]">
                        <b>{c.total_enviados}</b><span className="text-muted-foreground">/{c.total_destinatarios}</span> enviados ({pct}%)
                      </div>
                      {c.total_falhas > 0 && <div className="text-[12px] text-red-600">{c.total_falhas} falhas</div>}
                      {(c.status === "enviando" || c.status === "pausada") && (
                        <div className="h-1.5 bg-muted rounded mt-2 overflow-hidden ml-auto max-w-[140px]">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                    {(c.status === "rascunho") && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => { setEditing(c); setOpen(true); }}>Editar</Button>
                        <Button size="sm" onClick={() => handleStart(c.id)}><Play className="size-4 mr-1" /> Iniciar</Button>
                      </>
                    )}
                    {c.status === "enviando" && (
                      <Button size="sm" variant="outline" onClick={async () => { await pause({ data: { id: c.id, pause: true } }); await refresh(); }}>
                        <Pause className="size-4 mr-1" /> Pausar
                      </Button>
                    )}
                    {c.status === "pausada" && (
                      <Button size="sm" onClick={async () => { await pause({ data: { id: c.id, pause: false } }); await refresh(); }}>
                        <Play className="size-4 mr-1" /> Retomar
                      </Button>
                    )}
                    {(c.status === "agendada" || c.status === "enviando" || c.status === "pausada") && (
                      <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Cancelar campanha?")) { await cancel({ data: { id: c.id } }); await refresh(); } }}>
                        <X className="size-4" />
                      </Button>
                    )}
                    {(c.status === "rascunho" || c.status === "concluida" || c.status === "cancelada") && (
                      <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Excluir campanha?")) { await remove({ data: { id: c.id } }); await refresh(); } }}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--brand-soft-strong)] bg-[var(--brand-soft)]/40 p-5">
        <h3 className="font-display font-bold text-[14px] mb-2 flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--brand)] shadow-[0_0_10px_var(--brand)]" /> Anti-ban inteligente
        </h3>
        <p className="text-[13px] text-muted-foreground">
          Intervalo aleatório entre 5–20s entre disparos, pausa automática a cada 50 mensagens e detecção de respostas
          para pausar a campanha — tudo pra proteger seu número do WhatsApp.
        </p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar campanha" : "Nova campanha"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label>Nome interno</Label>
                <Input value={editing.nome} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} placeholder="Promo Black Friday" />
              </div>
              <div>
                <Label>Mensagem</Label>
                <Textarea rows={5} value={editing.mensagem} onChange={(e) => setEditing({ ...editing, mensagem: e.target.value })} placeholder="Olá {{nome}}, temos uma oferta..." />
                <p className="text-xs text-muted-foreground mt-1">Use <code>{"{{nome}}"}</code> para personalizar com o nome do contato.</p>
              </div>
              <div>
                <Label>Filtrar por tags do CRM</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tags.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma tag criada ainda — vazio = todos os contatos.</span>}
                  {tags.map((t) => {
                    const on = (editing.filtro_tags ?? []).includes(t);
                    return (
                      <button key={t} type="button"
                        onClick={() => {
                          const next = on ? editing.filtro_tags.filter((x: string) => x !== t) : [...(editing.filtro_tags ?? []), t];
                          setEditing({ ...editing, filtro_tags: next });
                          void calcPreview(next);
                        }}
                        className={`text-xs px-2 py-1 rounded-full border ${on ? "bg-primary text-primary-foreground border-primary" : "border-input"}`}>
                        {t}
                      </button>
                    );
                  })}
                </div>
                <Button type="button" variant="link" size="sm" className="px-0 mt-1" onClick={() => calcPreview(editing.filtro_tags ?? [])}>
                  Calcular público alvo
                </Button>
                {preview && <p className="text-xs">{preview.total} contatos serão impactados.</p>}
              </div>
              <div>
                <Label>Agendar para (opcional)</Label>
                <Input type="datetime-local" value={editing.agendado_para ? String(editing.agendado_para).slice(0, 16) : ""}
                  onChange={(e) => setEditing({ ...editing, agendado_para: e.target.value ? new Date(e.target.value).toISOString() : "" })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Intervalo mín. (seg)</Label>
                  <Input type="number" min={2} value={editing.intervalo_min_seg} onChange={(e) => setEditing({ ...editing, intervalo_min_seg: e.target.value })} />
                </div>
                <div>
                  <Label>Intervalo máx. (seg)</Label>
                  <Input type="number" min={2} value={editing.intervalo_max_seg} onChange={(e) => setEditing({ ...editing, intervalo_max_seg: e.target.value })} />
                </div>
                <div>
                  <Label>Pausa a cada N envios</Label>
                  <Input type="number" min={10} value={editing.pausa_apos_envios} onChange={(e) => setEditing({ ...editing, pausa_apos_envios: e.target.value })} />
                </div>
                <div>
                  <Label>Duração da pausa (min)</Label>
                  <Input type="number" min={1} value={editing.pausa_duracao_min} onChange={(e) => setEditing({ ...editing, pausa_duracao_min: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Anti-ban: intervalo aleatório entre envios e pausa longa periódica protegem seu número.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      <div className="font-display font-extrabold text-2xl mt-1">{value}</div>
    </div>
  );
}
