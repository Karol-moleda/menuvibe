-- Rejestracja z aplikacji: pierwsze konto zostaje właścicielem, kolejne są blokowane.
-- Konto jest od razu potwierdzone, więc nie trzeba klikać linku w e-mailu.

create or replace function public.guard_single_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'MENUVIBE_SIGNUP_CLOSED' using errcode = 'P0001';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

create trigger guard_single_owner
  before insert on auth.users
  for each row execute function public.guard_single_owner();

-- funkcji triggera nie wywołuje nikt z API
revoke execute on function public.guard_single_owner() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
