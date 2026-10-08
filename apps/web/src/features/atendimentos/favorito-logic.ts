export function formatPerfisFavoritos(perfis: Array<{ id: string; nome: string }>): string {
  if (!perfis || perfis.length === 0) {
    return 'Nenhum favorito';
  }
  const nomes = perfis.map((p) => p.nome).join(', ');
  return `Favoritado por ${nomes}`;
}
