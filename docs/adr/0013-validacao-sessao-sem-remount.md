# Validação de sessão não remonta a árvore autenticada

O `RequireSession` valida o token e atualiza o Perfil via `GET /me` (intervalo e foco), mas isso não pode reiniciar a página atual: remount via `key` no `Outlet` causava piscada e scroll no topo em qualquer rota autenticada. A decisão é propagar o Perfil por contexto React para os gates de papel (`RequireRole` / Home) sem desmontar a árvore — mudança de papel atualiza só o gate; expiração continua levando ao login.

## Consequences

Testes que disparam `focus` para refrescar Perfil (ex.: rebaixamento de papel) continuam válidos; não se deve reintroduzir `key` no `Outlet` autenticado para “forçar” releitura de papel.
