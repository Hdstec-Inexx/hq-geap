import { expect, type Locator } from '@playwright/test';

const factValueAlignPx = 2;

export async function expectFactValuesAligned(
  card: Locator,
  labelA: string,
  labelB: string
) {
  const valorA = card.locator('dt', { hasText: labelA }).locator('xpath=following-sibling::dd');
  const valorB = card.locator('dt', { hasText: labelB }).locator('xpath=following-sibling::dd');
  const [topA, topB] = await Promise.all([
    valorA.evaluate((node) => node.getBoundingClientRect().top),
    valorB.evaluate((node) => node.getBoundingClientRect().top)
  ]);
  expect(Math.abs(topA - topB)).toBeLessThan(factValueAlignPx);
}
