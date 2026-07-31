# HQ GEAP

Sistema de qualidade que analisa os atendimentos do agente de voz (ElevenLabs): uma IA Avaliadora avalia todas as interações e um Curador humano atua como fallback. Ler `CONTEXT.md` (glossário do domínio) e `docs/adr/` (decisões) antes de trabalhar no código. Plano de fases em `PLANO.md`.

## Agent skills

### Issue tracker

Issues e specs vivem como GitHub issues neste repo (`Hdstec-Inexx/hq-geap`), via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário padrão das skills: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` na raiz + `docs/adr/`. See `docs/agents/domain.md`.
