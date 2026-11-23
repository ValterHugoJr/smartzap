import { createFileRoute, redirect } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { brand } from "@/config/brand";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Bot, MessageCircle, Target, DollarSign, Download, Clock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/relatorios")({
  head: () => ({ meta: [{ title: `${brand.name} — Relatórios` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: RelatoriosPage,
});

type Period = "today" | "7d" | "30d" | "custom";

function rangeOf(p: Period, from?: string, to?: string) {
  const end = new Date();
  if (p === "today") { const s = new Date(); s.setHours(0, 0, 0, 0); return { start: s, end }; }
  if (p === "7d") return { start: new Date(Date.now() - 7 * 86400000), end };
  if (p === "30d") return { start: new Date(Date.now() - 30 * 86400000), end };
  return { start: from ? new Date(from) : new Date(Date.now() - 7 * 86400000), end: to ? new Date(to) : end };
}

function RelatoriosPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const [period, setPeriod] = useState<Period>("30d");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [msgs, setMsgs] = useState<{ created_at: string; direcao: string; autor: string; user_id: string | null }[]>([]);
  const [cards, setCards] = useState<{ status: string; stage_id: string | null; valor: number; owner_id: string | null; ultima_em: string }[]>([]);
  const [stages, setStages] = useState<{ id: string; nome: string; cor: string; tipo: string }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; nome: string | null; email: string | null }[]>([]);
  const [csat, setCsat] = useState<{ score: number | null; respondido_em: string | null }[]>([]);

  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const [{ data: m }, { data: c }, { data: st }, { data: cu }, { data: cs }] = await Promise.all([
        supabase.from("mensagens").select("created_at,direcao,autor,user_id").eq("company_id", companyId).gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString()),
        supabase.from("crm_cards").select("status,stage_id,valor,owner_id,ultima_em").eq("company_id", companyId),
        supabase.from("crm_stage").select("id,nome,cor,tipo,ordem").eq("company_id", companyId).order("ordem", { ascending: true }),
        supabase.from("company_user").select("user_id,profiles(nome,email)").eq("company_id", companyId).eq("ativo", true),
        supabase.from("csat_response").select("score,respondido_em").eq("company_id", companyId).gte("enviado_em", range.start.toISOString()).lte("enviado_em", range.end.toISOString()),
      ]);
      setMsgs((m ?? []) as any);
      setCards((c ?? []) as any);
      setStages((st ?? []) as any);
      setCsat(((cs ?? []) as any).map((r: any) => ({ score: r.score, respondido_em: r.respondido_em })));
      setMembers(((cu ?? []) as any[]).map((r) => ({
        user_id: r.user_id, nome: r.profiles?.nome ?? null, email: r.profiles?.email ?? null,
      })));
    })();
  }, [companyId, range.start.getTime(), range.end.getTime()]);

  // Tempo médio de resposta: para cada mensagem 'entrada', achar a próxima 'saida' do mesmo dia
  const tempoMedioMs = useMemo(() => {
    const sorted = [...msgs].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const deltas: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].direcao !== "entrada") continue;
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].direcao === "saida") {
          deltas.push(+new Date(sorted[j].created_at) - +new Date(sorted[i].created_at));
          break;
        }
      }
    }
    if (!deltas.length) return 0;
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }, [msgs]);

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const totalMsgs = msgs.length;
  const respIa = msgs.filter((m) => m.autor === "ia").length;
  const ganho = cards.filter((c) => c.stage_id && stageMap.get(c.stage_id)?.tipo === "ganho");
  const receita = ganho.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const conversao = cards.length ? Math.round((ganho.length / cards.length) * 100) : 0;
  const csatRespondidos = csat.filter((c) => c.score != null);
  const csatMedia = csatRespondidos.length ? (csatRespondidos.reduce((s, c) => s + (c.score ?? 0), 0) / csatRespondidos.length) : 0;
  const csatTaxa = csat.length ? Math.round((csatRespondidos.length / csat.length) * 100) : 0;

  const perDay = useMemo(() => {
    const days = Math.min(30, Math.max(1, Math.ceil((+range.end - +range.start) / 86400000)));
    const map = new Map<string, { recebidas: number; respondidasIa: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(range.end.getTime() - i * 86400000);
      map.set(d.toISOString().slice(0, 10), { recebidas: 0, respondidasIa: 0 });
    }
    msgs.forEach((m) => {
      const k = new Date(m.created_at).toISOString().slice(0, 10);
      const cur = map.get(k);
      if (!cur) return;
      if (m.direcao === "entrada") cur.recebidas += 1;
      if (m.autor === "ia") cur.respondidasIa += 1;
    });
    return Array.from(map.entries()).map(([d, v]) => ({ dia: d.slice(5), ...v }));
  }, [msgs, range.start.getTime(), range.end.getTime()]);

  const byStage = useMemo(() => {
    return stages.map((s) => {
      const v = cards.filter((c) => c.stage_id === s.id).length;
      return { name: s.nome, value: v, fill: s.cor };
    });
  }, [cards, stages]);

  const byAtendente = useMemo(() => {
    const map = new Map<string, { recebidas: number; respondidas: number; ganhos: number }>();
    members.forEach((m) => map.set(m.user_id, { recebidas: 0, respondidas: 0, ganhos: 0 }));
    msgs.forEach((m) => {
      if (!m.user_id) return;
      const cur = map.get(m.user_id) ?? { recebidas: 0, respondidas: 0, ganhos: 0 };
      if (m.direcao === "entrada") cur.recebidas += 1;
      if (m.direcao === "saida" && m.autor === "humano") cur.respondidas += 1;
      map.set(m.user_id, cur);
    });
    cards.forEach((c) => {
      if (c.owner_id && c.stage_id && stageMap.get(c.stage_id)?.tipo === "ganho") {
        const cur = map.get(c.owner_id) ?? { recebidas: 0, respondidas: 0, ganhos: 0 };
        cur.ganhos += 1; map.set(c.owner_id, cur);
      }
    });
    const humanos = members.map((m) => {
      const v = map.get(m.user_id) ?? { recebidas: 0, respondidas: 0, ganhos: 0 };
      return {
        nome: (m.nome || m.email || m.user_id.slice(0, 6)) as string,
        ...v,
        taxa: v.recebidas ? Math.round((v.ganhos / v.recebidas) * 100) : 0,
        ia: false,
      };
    }).filter((r) => r.recebidas + r.respondidas + r.ganhos > 0);
    const iaRow = {
      nome: "Agente IA",
      recebidas: msgs.filter((m) => m.direcao === "entrada").length,
      respondidas: respIa,
      ganhos: 0,
      taxa: 0,
      ia: true,
    };
    return iaRow.recebidas + iaRow.respondidas > 0 ? [iaRow, ...humanos] : humanos;
  }, [msgs, cards, members, stageMap]);

  function exportCSV() {
    const lines: string[] = [];
    lines.push("Métrica;Valor");
    lines.push(`Período;${range.start.toLocaleDateString("pt-BR")} → ${range.end.toLocaleDateString("pt-BR")}`);
    lines.push(`Mensagens;${totalMsgs}`);
    lines.push(`Respondidas pela IA;${respIa}`);
    lines.push(`Cards totais;${cards.length}`);
    lines.push(`Ganhos;${ganho.length}`);
    lines.push(`Receita (R$);${receita.toFixed(2)}`);
    lines.push(`Conversão (%);${conversao}`);
    lines.push(`Tempo médio resposta (s);${Math.round(tempoMedioMs / 1000)}`);
    lines.push(`CSAT médio (1-5);${csatMedia ? csatMedia.toFixed(2) : "-"}`);
    lines.push(`CSAT respostas;${csatRespondidos.length}/${csat.length}`);
    lines.push("");
    lines.push("Etapa;Cards");
    byStage.forEach((s) => lines.push(`${s.name};${s.value}`));
    lines.push("");
    lines.push("Atendente;Recebidas;Respondidas;Ganhos;Taxa (%)");
    byAtendente.forEach((a) => lines.push(`${a.nome};${a.recebidas};${a.respondidas};${a.ia ? "-" : a.ganhos};${a.ia ? "-" : a.taxa}`));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio_${range.start.toISOString().slice(0, 10)}_${range.end.toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const tooltipStyle = {
    background: "var(--panel)", border: "1px solid var(--hairline)",
    borderRadius: 12, color: "var(--foreground)",
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight flex items-center gap-2">Relatórios <HelpTip text="Métricas de atendimento, conversão por etapa do CRM, tempo de resposta, performance por atendente e nota média de satisfação (CSAT)." /></h1>
          <p className="text-sm text-muted-foreground">{range.start.toLocaleDateString("pt-BR")} → {range.end.toLocaleDateString("pt-BR")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodTabs value={period} onChange={setPeriod} />
          {period === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-[color:var(--panel)] border border-[color:var(--hairline)] rounded-md px-2 py-1.5 text-[13px]" />
              <span className="text-muted-foreground">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-[color:var(--panel)] border border-[color:var(--hairline)] rounded-md px-2 py-1.5 text-[13px]" />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="size-4 mr-2" />Exportar CSV</Button>
        </div>
      </header>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard accent icon={<MessageCircle className="size-4" />} label="Mensagens" value={totalMsgs} trend="no período" />
        <KpiCard icon={<Bot className="size-4" />} label="IA respondeu" value={respIa} trend={`${totalMsgs ? Math.round((respIa / totalMsgs) * 100) : 0}% das mensagens`} />
        <KpiCard icon={<Clock className="size-4" />} label="Tempo médio resposta" value={tempoMedioMs ? `${Math.round(tempoMedioMs / 1000)}s` : "—"} trend="estimado entrada → saída" />
        <KpiCard icon={<Target className="size-4" />} label="Conversão" value={`${conversao}%`} trend={`${ganho.length} ganhos / ${cards.length} cards`} />
        <KpiCard icon={<DollarSign className="size-4" />} label="Receita" value={`R$ ${receita.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} trend="cards em etapas de ganho" />
        <KpiCard icon={<Star className="size-4" />} label="CSAT" value={csatMedia ? `${csatMedia.toFixed(1)} / 5` : "—"} trend={`${csatRespondidos.length}/${csat.length} resp. (${csatTaxa}%)`} />
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
          <h3 className="font-display text-[17px] font-semibold">Mensagens por dia</h3>
          <p className="text-xs text-muted-foreground mb-3">recebidas vs respondidas pela IA</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={perDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in oklab, currentColor 12%, transparent)" />
              <XAxis dataKey="dia" fontSize={11} stroke="currentColor" opacity={0.6} />
              <YAxis fontSize={11} allowDecimals={false} stroke="currentColor" opacity={0.6} />
              <Tooltip contentStyle={tooltipStyle as any} />
              <Area type="monotone" dataKey="recebidas" name="Recebidas" stroke={brand.primary} fill={brand.primary} fillOpacity={0.25} strokeWidth={2} />
              <Area type="monotone" dataKey="respondidasIa" name="Respondidas pela IA" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.25} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
          <h3 className="font-display text-[17px] font-semibold">Distribuição por etapa</h3>
          <p className="text-xs text-muted-foreground mb-3">cards no funil</p>
          <div className="space-y-3">
            {byStage.map((s) => {
              const total = byStage.reduce((a, b) => a + b.value, 0) || 1;
              const pct = Math.round((s.value / total) * 100);
              return (
                <div key={s.name}>
                  <div className="flex items-center gap-2 text-[13px] mb-1">
                    <span className="size-2.5 rounded-full" style={{ background: s.fill }} />
                    <span className="text-muted-foreground">{s.name}</span>
                    <span className="ml-auto font-semibold">{s.value} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[color:var(--panel-2)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.fill }} />
                  </div>
                </div>
              );
            })}
            {byStage.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">Sem etapas cadastradas.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-display text-[17px] font-semibold">Conversão por atendente</h3>
            <p className="text-xs text-muted-foreground">recebidas, respondidas e ganhos no período</p>
          </div>
          <Bot className="size-4 text-muted-foreground" />
        </div>
        {byAtendente.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem atividade no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-[color:var(--hairline)]">
                  <th className="py-2 pr-3 font-semibold">Atendente</th>
                  <th className="py-2 px-3 font-semibold text-right">Recebidas</th>
                  <th className="py-2 px-3 font-semibold text-right">Respondidas</th>
                  <th className="py-2 px-3 font-semibold text-right">Ganhos</th>
                  <th className="py-2 pl-3 font-semibold text-right">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {byAtendente.map((a) => (
                  <tr key={a.nome} className="border-b border-[color:var(--hairline)] last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{a.nome}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{a.recebidas}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{a.respondidas}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{a.ia ? "—" : a.ganhos}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{a.ia ? "—" : `${a.taxa}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[color:var(--hairline)] bg-[color:var(--panel)] p-1">
      {(["today", "7d", "30d", "custom"] as Period[]).map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${
            value === p ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-text)]" : "text-muted-foreground hover:text-foreground"
          }`}>
          {p === "today" ? "Hoje" : p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "Personalizado"}
        </button>
      ))}
    </div>
  );
}
