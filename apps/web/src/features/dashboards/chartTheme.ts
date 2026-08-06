export const motivosPalette = [
  '#1f6f5b',
  '#c45c26',
  '#2f5d8c',
  '#8a4f7d',
  '#b08900',
  '#4a6fa5',
  '#6b8f71',
  '#9c6644'
];

export function motivosColors(count: number) {
  return Array.from(
    { length: count },
    (_, index) => motivosPalette[index % motivosPalette.length]!
  );
}
