do $$
begin
  if exists (
    select lower(email)
    from usuarios
    group by lower(email)
    having count(*) > 1
  ) then
    raise exception 'usuarios possuem emails duplicados sem diferenca de caixa; resolva as colisoes antes da migration';
  end if;
end $$;

alter table usuarios drop constraint usuarios_email_key;
create unique index usuarios_email_lower_key on usuarios (lower(email));
