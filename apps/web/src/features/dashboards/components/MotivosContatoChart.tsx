import type { Dashboard } from '@hq-geap/contracts/dashboards';

const palette = [
  '#1f6f5b',
  '#c45c26',
  '#2f5d8c',
  '#8a4f7d',
  '#b08900',
  '#4a6fa5',
  '#6b8f71',
  '#9c6644'
];

export function MotivosContatoChart({
  motivos
}: {
  motivos: Dashboard['motivosContato'];
}) {
  const total = motivos.reduce((sum, item) => sum + item.total, 0);
  let cursor = 0;
  const segments = motivos.map((item, index) => {
    const start = cursor;
    const share = total === 0 ? 0 : (item.total / total) * 100;
    cursor += share;
    return {
      ...item,
      start,
      share,
      color: palette[index % palette.length]!
    };
  });
  const gradient =
    segments.length === 0
      ? '#d9d5cc'
      : `conic-gradient(${segments
          .map(({ color, start, share }) => `${color} ${start}% ${start + share}%`)
          .join(', ')})`;

  return (
    <section className="dashboard-panel motivos-panel">
      <header>
        <p className="dashboard-panel-kicker">Distribuição</p>
        <h2>Motivos de Contato</h2>
      </header>
      {motivos.length === 0 ? (
        <p className="dashboard-empty">Nenhum Motivo de Contato no período.</p>
      ) : (
        <div className="motivos-donut-layout">
          <div
            aria-hidden="true"
            className="motivos-donut"
            style={{ background: gradient }}
          />
          <ul className="motivos-legend">
            {segments.map(({ motivo, total: count, color, share }) => (
              <li key={motivo}>
                <span className="motivos-swatch" style={{ background: color }} />
                <span>{motivo}</span>
                <strong>
                  {count.toLocaleString('pt-BR')} ({share.toFixed(0)}%)
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
