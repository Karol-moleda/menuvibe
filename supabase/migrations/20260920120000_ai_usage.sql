-- Dzienny limit zapytań do Claude. Licznik zwiększa funkcja ai-chat przez RPC
-- (security definer), więc tabela ai_usage pozostaje dla użytkownika tylko do odczytu.

create or replace function public.ai_usage_register(p_date date, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_requests integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.ai_usage (user_id, date, requests)
  values (v_uid, p_date, 1)
  on conflict (user_id, date) do update set requests = public.ai_usage.requests + 1
  returning requests into v_requests;
  if v_requests > p_limit then
    raise exception 'MENUVIBE_AI_LIMIT' using errcode = 'P0001';
  end if;
  return v_requests;
end;
$$;

create or replace function public.ai_usage_add_tokens(p_date date, p_input integer, p_output integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set input_tokens = input_tokens + greatest(p_input, 0),
         output_tokens = output_tokens + greatest(p_output, 0)
   where user_id = auth.uid() and date = p_date;
$$;

revoke execute on function public.ai_usage_register(date, integer) from public, anon;
revoke execute on function public.ai_usage_add_tokens(date, integer, integer) from public, anon;
grant execute on function public.ai_usage_register(date, integer) to authenticated;
grant execute on function public.ai_usage_add_tokens(date, integer, integer) to authenticated;
