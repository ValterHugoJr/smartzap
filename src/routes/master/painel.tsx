import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { brand } from "@/config/brand";
import { Building2, MessageSquareText, KanbanSquare, TrendingUp, Activity, Pause, Sparkles, RefreshCw } from "lucide-react";
import { masterKpis, getSystemStatus } from "@/lib/master.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/master/painel")({
  head: () => ({ meta: [{ title: `${brand.name} — Master` }] }),
  component: Painel,
});

function Painel() {
  const kpis = useServerFn(masterKpis);
  const statusFn = useServerFn(getSystemStatus);
  const [data, setData] = useState<{ stats: any; series: { mes: string; total: number }[] } | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  async function loadStatus() {
    setStatusLoading(true);
    try { setStatus(await statusFn()); } catch (e: any) { toast.error(e?.message); }
    finally { setStatusLoading(false); }
  }

  useEffect(() => {
    void (async () => {
      try { setData(await kpis()); } catch (e: any) { toast.error(e?.message); }
    })();
    void loadStatus();
  }, []);

  if (!data) return <div className="text-sm text-muted-foreground">Carregando…</div>;
  const s = data.stats;

  return (
    <div className="space-y-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold">Painel Master</h1>
          <p className="text-xs text-muted-foreground">Visão geral de toda a plataforma.</p>
        </div>
        <div className="flex items-center gap-2 bg-[rgba(255,90,90,.10)] border border-[rgba(255,90,90,.30)] text-[#ffb3b3] text-[12.5px] font-semibold px-3 py-1.5 rounded-full">
          <span className="size-2 rounded-full bg-[#FF5A5A]" /> Modo Master
        </div>
      </header>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <MasterKpi accent icon={<Building2 className="size-4" />} label="Empresas" value={s.total} trend={`+${s.novasMes} este mês`} />
        <MasterKpi icon={<Activity className="size-4" />} label="Ativas" value={s.ativas} trend={`${Math.round((s.ativas / Math.max(1, s.total)) * 100)}%`} />
        <MasterKpi icon={<Sparkles className="size-4" />} label="Em trial" value={s.trial} />
        <MasterKpi icon={<Pause className="size-4" />} label="Suspensas" value={s.suspensas} />
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-3">
        <MasterKpi icon={<TrendingUp className="size-4" />} label="Novas no mês" value={s.novasMes} />
        <MasterKpi icon={<MessageSquareText className="size-4" />} label="Mensagens (total)" value={s.mensagens} />
        <MasterKpi icon={<KanbanSquare className="size-4" />} label="Cards no funil (total)" value={s.cards} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[15px] font-semibold">Status do sistema</h2>
          <button
            onClick={() => void loadStatus()}
            disabled={statusLoading}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#ffb3b3] border border-[rgba(255,90,90,.30)] bg-[rgba(255,90,90,.10)] px-3 py-1.5 rounded-full disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${statusLoading ? "animate-spin" : ""}`} /> Verificar agora
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          {status ? `Verificado às ${new Date(status.checkedAt).toLocaleTimeString("pt-BR")}` : "Verificando…"}
        </p>
        {status && (
          <div className="divide-y divide-border">
            <StatusRow ok={status.ia.ok} warn={status.ia.warn} title="IA da plataforma (Gemini)" detail={status.ia.detail} latencyMs={status.ia.latencyMs} />
            <StatusRow ok={status.evolution.online && status.evolution.keyStatus === "global_ok"} warn={status.evolution.online} title="Servidor WhatsApp (Evolution)" detail={status.evolution.detail} />
            <StatusRow ok={status.whatsapp.total > 0 && status.whatsapp.connected === status.whatsapp.total} warn title="Conexões WhatsApp" detail={status.whatsapp.detail} />
            <StatusRow ok={status.database.ok} warn={false} title="Banco de dados" detail={status.database.detail} latencyMs={status.database.latencyMs} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-[15px] font-semibold">Crescimento de empresas</h2>
        <p className="text-xs text-muted-foreground mb-3">últimos 12 meses</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.series}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
            <XAxis dataKey="mes" fontSize={11} stroke="#8AA89A" />
            <YAxis fontSize={11} allowDecimals={false} stroke="#8AA89A" />
            <Tooltip contentStyle={{ background: "#13211A", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, color: "#EAF6EF" }} />
            <Line type="monotone" dataKey="total" stroke="#FF5A5A" strokeWidth={2.5} dot={{ r: 3, fill: "#FF5A5A" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatusRow({ ok, warn, title, detail, latencyMs }: { ok: boolean; warn?: boolean; title: string; detail: string; latencyMs?: number }) {
  const color = ok ? "bg-emerald-400" : warn ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-start gap-3 py-3">
      <span className={`size-2.5 rounded-full mt-1 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {title}
          {latencyMs != null && <span className="text-xs font-normal text-muted-foreground"> · {latencyMs} ms</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

function MasterKpi({ icon, label, value, trend, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; trend?: React.ReactNode; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 ${
        accent
          ? "border-[rgba(255,90,90,.30)] bg-[linear-gradient(160deg,rgba(255,90,90,.14),rgba(255,90,90,.02))]"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="text-[#FF5A5A]">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display font-extrabold text-2xl sm:text-3xl mt-2">{value}</div>
      {trend && <div className="text-xs mt-2 text-[#ffb3b3] flex items-center gap-1.5"><TrendingUp className="size-3.5" />{trend}</div>}
    </div>
  );
}
