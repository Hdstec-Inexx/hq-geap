import type { Locator, Page } from '@playwright/test';

export const shortTranscript = [
  { role: 'agent' as const, message: 'Ola', time_in_call_secs: 0 }
];

export function longTranscript() {
  return Array.from({ length: 40 }, (_, i) => ({
    role: (i % 2 === 0 ? 'agent' : 'user') as 'agent' | 'user',
    message: `Turno ${i}: preciso de ajuda com o boleto e a rede credenciada.`,
    time_in_call_secs: i * 5
  }));
}

export function transcriptScroll(page: Page) {
  return page.getByTestId('transcript-scroll');
}

export async function transcriptOverflows(scroll: Locator) {
  return scroll.evaluate((el) => el.scrollHeight > el.clientHeight);
}

export async function firstTurnFitsWithoutEmptyBox(scroll: Locator) {
  const metrics = await scroll.evaluate((el) => {
    const article = el.querySelector('article');
    return {
      clientHeight: el.clientHeight,
      articleHeight: article?.getBoundingClientRect().height ?? 0
    };
  });
  return metrics.clientHeight < metrics.articleHeight * 4;
}
