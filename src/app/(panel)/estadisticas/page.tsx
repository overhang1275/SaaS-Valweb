import { requireActor } from "@/lib/auth";
import { getUsageStatistics, parseStatisticsPeriod } from "@/features/statistics/service";

export const metadata = { title: "Estadísticas" };
type SearchParams = Promise<{ periodo?: string | string[]; cuenta?: string | string[] }>;

function formatCount(value: bigint) {
  return value.toLocaleString("es-MX");
}

function UsageChart({ days, period }: { days: Awaited<ReturnType<typeof getUsageStatistics>>["days"]; period: number }) {
  const width = 760, height = 250, left = 58, right = 12, top = 16, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maximum = days.reduce((max, day) => day.queries > max ? day.queries : max, 0n);
  const scale = maximum || 1n;
  const slot = plotWidth / days.length;
  const barWidth = Math.max(2, Math.min(12, slot * 0.58));
  const xLabels = new Set(period === 7 ? days.map((_, index) => index) : [0, Math.floor((days.length - 1) / 2), days.length - 1]);
  const from = days[0]?.label ?? "";
  const through = days.at(-1)?.label ?? "";

  return <figure className="usage-chart-figure">
    <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="usage-chart-title usage-chart-description">
      <title id="usage-chart-title">Consultas por día</title>
      <desc id="usage-chart-description">Consultas diarias del periodo, de {from} a {through}. Total: {formatCount(days.reduce((sum, day) => sum + day.queries, 0n))}.</desc>
      {[0, 1, 2, 3, 4].map(tick => {
        const y = top + plotHeight - plotHeight * tick / 4;
        const label = formatCount(maximum * BigInt(tick) / 4n);
        return <g key={tick}>
          <line x1={left} x2={width - right} y1={y} y2={y} className="usage-chart-gridline" />
          <text x={left - 10} y={y + 4} textAnchor="end" className="usage-chart-axis">{label}</text>
        </g>;
      })}
      {days.map((day, index) => {
        const barHeight = Number(day.queries * BigInt(plotHeight) / scale);
        const x = left + index * slot + (slot - barWidth) / 2;
        const y = top + plotHeight - barHeight;
        return <g key={day.date}>
          {barHeight > 0 && <title>{`${day.label}: ${formatCount(day.queries)} consultas`}</title>}
          {barHeight > 0 && <rect x={x} y={y} width={barWidth} height={barHeight} className="usage-chart-bar" />}
          {xLabels.has(index) && <text x={left + index * slot + slot / 2} y={height - 8} textAnchor="middle" className="usage-chart-axis">{day.label}</text>}
        </g>;
      })}
    </svg>
    <figcaption className="help">Consultas diarias · últimos {period} días</figcaption>
  </figure>;
}

export default async function StatisticsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor();
  const params = await searchParams;
  const period = parseStatisticsPeriod(typeof params.periodo === "string" ? params.periodo : undefined);
  const requestedTenantId = typeof params.cuenta === "string" ? params.cuenta : undefined;
  const statistics = await getUsageStatistics(actor, period, requestedTenantId);
  const admin = actor.role === "ADMIN";
  const foundRate = statistics.queries === 0n ? 0 : Number(statistics.found * 1000n / statistics.queries) / 10;

  return <>
    <div className="page-heading statistics-heading"><div><h1>Estadísticas</h1><p>Cada intento válido cuenta como consulta; se excluyen formatos inválidos y solicitudes bloqueadas.</p></div></div>
    <form action="/estadisticas" method="get" className="statistics-filters">
      <div className="field"><label htmlFor="statistics-period">Periodo</label><select id="statistics-period" name="periodo" defaultValue={String(period)}><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select></div>
      {admin && <div className="field"><label htmlFor="statistics-account">Cuenta</label><select id="statistics-account" name="cuenta" defaultValue={statistics.selectedTenantId ?? ""}><option value="">Todas las cuentas</option>{statistics.tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div>}
      <button className="button button-secondary" type="submit">Aplicar</button>
    </form>
    <dl className="usage-kpis">
      {[{ label: "Consultas", value: statistics.queries }, { label: "Encontradas", value: statistics.found, detail: `${foundRate.toLocaleString("es-MX", { maximumFractionDigits: 1 })}% del total` }, { label: "No encontradas", value: statistics.notFound }, { label: "Validaciones activas", value: BigInt(statistics.activeValidations) }].map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{formatCount(metric.value)}</dd>{"detail" in metric && <small>{metric.detail}</small>}</div>)}
    </dl>
    <div className="usage-statistics-grid">
      <section className="surface usage-chart-panel" aria-labelledby="usage-trend-title">
        <div className="section-line"><h2 id="usage-trend-title">Tendencia de consultas</h2><span>Por día</span></div>
        <UsageChart days={statistics.days} period={period} />
        {statistics.queries === 0n && <p className="help usage-chart-empty">No hubo consultas durante este periodo.</p>}
      </section>
      <section className="surface usage-ranking" aria-labelledby="usage-ranking-title">
        <div className="section-line"><h2 id="usage-ranking-title">Más consultadas</h2><span>5 principales</span></div>
        {statistics.topValidations.length ? <div className="table-scroll"><table>
          <caption className="sr-only">Validaciones con más consultas durante el periodo</caption>
          <thead><tr><th scope="col">Validación</th>{admin && <th scope="col">Cuenta</th>}<th scope="col" className="num">Consultas</th></tr></thead>
          <tbody>{statistics.topValidations.map(validation => <tr key={validation.id}><td><strong>{validation.name}</strong></td>{admin && <td>{validation.tenantName}</td>}<td className="num">{formatCount(validation.queries)}</td></tr>)}</tbody>
        </table></div> : <p className="help usage-ranking-empty">Aún no hay consultas en este periodo.</p>}
      </section>
    </div>
  </>;
}
