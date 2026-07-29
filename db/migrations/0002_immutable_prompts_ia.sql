alter table prompts_ia_avaliadora alter column temperatura set not null;

create function proteger_prompt_ia_imutavel()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AI configuration versions are immutable';
  end if;

  if old.ativo
    and not new.ativo
    and new.id is not distinct from old.id
    and new.versao is not distinct from old.versao
    and new.prompt is not distinct from old.prompt
    and new.provedor is not distinct from old.provedor
    and new.modelo is not distinct from old.modelo
    and new.temperatura is not distinct from old.temperatura
    and new.criado_por is not distinct from old.criado_por
    and new.criado_em is not distinct from old.criado_em
  then
    return new;
  end if;

  raise exception 'AI configuration versions are immutable';
end;
$$;

create trigger prompts_ia_avaliadora_imutaveis
before update or delete on prompts_ia_avaliadora
for each row execute function proteger_prompt_ia_imutavel();
