-- Przepisy Respo: posiłek 2 to w praktyce kolacja, a posiłek 3 – obiad.
-- Zamieniamy obiad z kolacją w przepisach od dietetyczki Respo
-- oraz w planie od dziś, żeby bieżący tydzień od razu się zgadzał.

update public.recipes
set slot = case slot when 'lunch' then 'dinner'::public.meal_slot else 'lunch'::public.meal_slot end,
    updated_at = now()
where origin = 'dietitian_respo'
  and slot in ('lunch', 'dinner');

-- unique (plan_id, date, slot) blokuje zamianę jednym UPDATE-em, więc przez tabelę tymczasową
create temp table _swap_items as
select *
from public.meal_plan_items
where date >= current_date
  and slot in ('lunch', 'dinner');

delete from public.meal_plan_items
where id in (select id from _swap_items);

insert into public.meal_plan_items (id, plan_id, user_id, date, slot, recipe_id, portion_factor, locked)
select id, plan_id, user_id, date,
       case slot when 'lunch' then 'dinner'::public.meal_slot else 'lunch'::public.meal_slot end,
       recipe_id, portion_factor, locked
from _swap_items;

drop table _swap_items;
