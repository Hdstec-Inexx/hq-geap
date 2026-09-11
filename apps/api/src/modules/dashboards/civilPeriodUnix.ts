import type { DashboardPeriod } from '@hq-geap/contracts/dashboards';

const TIME_ZONE = 'America/Sao_Paulo';

function addOneIsoDate(isoDate: string): string {
  const next = new Date(`${isoDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function civilMidnightUnix(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  let guess = Date.UTC(year, month - 1, day, 3, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date(guess));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second')
    );
    const wanted = Date.UTC(year, month - 1, day, 0, 0, 0);
    guess += wanted - asUtc;
  }
  return Math.floor(guess / 1000);
}

export function civilPeriodUnixBounds(periodo: DashboardPeriod): {
  callStartAfterUnix: number;
  callStartBeforeUnix: number;
} {
  return {
    callStartAfterUnix: civilMidnightUnix(periodo.inicio),
    callStartBeforeUnix: civilMidnightUnix(addOneIsoDate(periodo.fim))
  };
}
