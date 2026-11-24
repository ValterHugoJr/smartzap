import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { brand } from "@/config/brand";

// Layout das rotas do Agente IA: a página principal é agente.index.tsx e a
// edição avançada é agente.avancado.tsx. Este arquivo NÃO pode renderizar a
// página diretamente — sem <Outlet/>, a rota filha /app/agente/avancado
// nunca monta (foi o bug que fazia o "preencher manualmente" cair no
// assistente inicial). A guarda de papel (atendente) vive aqui e vale
// pras duas filhas.
export const Route = createFileRoute("/app/agente")({
  head: () => ({ meta: [{ title: `${brand.name} — Agente IA` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: () => <Outlet />,
});
