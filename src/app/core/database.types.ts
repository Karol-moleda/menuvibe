// Typy bazy MenuVibe – odpowiadają supabase/migrations.
// Po wdrożeniu można je nadpisać wygenerowanymi:
//   npx supabase gen types typescript --linked > src/app/core/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MealSlot = 'breakfast' | 'snack' | 'lunch' | 'dinner';
export type Sex = 'male' | 'female';
export type Goal = 'cut' | 'maintain' | 'gain';
export type DiaryKind = 'recipe' | 'product' | 'manual';
export type RecipeOrigin = 'dietitian_respo' | 'dietitian_activezone' | 'claude' | 'own';
export type TargetMethod = 'formula' | 'adaptive' | 'manual';
export type ChatRole = 'user' | 'assistant';

/** Kolumny z wartością domyślną w bazie – opcjonalne przy insert. */
type Table<Row, Defaults extends keyof Row> = {
  Row: Row;
  Insert: Omit<Row, Defaults> & Partial<Pick<Row, Defaults>>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_pal: number | null;
  goal: Goal;
  weekly_rate_pct: number;
  protein_g_per_kg: number;
  fat_pct: number;
  slot_split: Record<MealSlot, number>;
  water_goal_ml: number;
  recalc_day: number;
  created_at: string;
  updated_at: string;
}

export interface CalorieTargetRow {
  id: string;
  user_id: string;
  valid_from: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  method: TargetMethod;
  bmr: number | null;
  tdee: number | null;
  weight_kg: number | null;
  note: string | null;
  created_at: string;
}

export interface WeightEntryRow {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number;
  created_at: string;
}

export interface RecipeRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  slot: MealSlot;
  servings: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  macros_estimated: boolean;
  steps: string[];
  origin: RecipeOrigin;
  sources: Json;
  tags: string[];
  rating: number;
  prep_minutes: number | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecipeIngredientRow {
  id: string;
  recipe_id: string;
  user_id: string;
  position: number;
  name: string;
  amount: number;
  unit: string;
  household: string | null;
  category: string;
  grp: string | null;
}

export interface MealPlanRow {
  id: string;
  user_id: string;
  week_start: string;
  created_at: string;
  updated_at: string;
}

export interface MealPlanItemRow {
  id: string;
  plan_id: string;
  user_id: string;
  date: string;
  slot: MealSlot;
  recipe_id: string;
  portion_factor: number;
  locked: boolean;
}

export interface ProductRow {
  id: string;
  user_id: string;
  ean: string | null;
  name: string;
  brand: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  default_grams: number | null;
  source: 'off' | 'manual';
  favorite: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface DiaryEntryRow {
  id: string;
  user_id: string;
  date: string;
  slot: MealSlot;
  kind: DiaryKind;
  recipe_id: string | null;
  product_id: string | null;
  name: string;
  grams: number | null;
  servings: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  created_at: string;
}

export interface WaterEntryRow {
  id: string;
  user_id: string;
  date: string;
  ml: number;
  created_at: string;
}

export interface ShoppingListRow {
  id: string;
  user_id: string;
  date_from: string;
  date_to: string;
  items: Json;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  user_id: string;
  role: ChatRole;
  content: string;
  recipe: Json | null;
  created_at: string;
}

export interface SubstitutionRow {
  id: string;
  user_id: string;
  section: string | null;
  note: string | null;
  items: Json;
  position: number;
}

export interface AiUsageRow {
  user_id: string;
  date: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
}

type Common = 'user_id';
type Ts = 'created_at';

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        | Common
        | 'display_name' | 'sex' | 'birth_date' | 'height_cm' | 'activity_pal' | 'goal'
        | 'weekly_rate_pct' | 'protein_g_per_kg' | 'fat_pct' | 'slot_split' | 'water_goal_ml'
        | 'recalc_day' | Ts | 'updated_at'
      >;
      calorie_targets: Table<CalorieTargetRow, 'id' | Common | 'bmr' | 'tdee' | 'weight_kg' | 'note' | Ts>;
      weight_entries: Table<WeightEntryRow, 'id' | Common | Ts>;
      recipes: Table<
        RecipeRow,
        | 'id' | Common | 'servings' | 'macros_estimated' | 'steps' | 'origin' | 'sources' | 'tags'
        | 'rating' | 'prep_minutes' | 'archived' | Ts | 'updated_at'
      >;
      recipe_ingredients: Table<RecipeIngredientRow, 'id' | Common | 'position' | 'unit' | 'household' | 'category' | 'grp'>;
      meal_plans: Table<MealPlanRow, 'id' | Common | Ts | 'updated_at'>;
      meal_plan_items: Table<MealPlanItemRow, 'id' | Common | 'portion_factor' | 'locked'>;
      products: Table<
        ProductRow,
        'id' | Common | 'ean' | 'brand' | 'protein_100g' | 'carbs_100g' | 'fat_100g' | 'default_grams' | 'source' | 'favorite' | 'last_used_at' | Ts
      >;
      diary_entries: Table<
        DiaryEntryRow,
        'id' | Common | 'recipe_id' | 'product_id' | 'grams' | 'servings' | 'protein_g' | 'carbs_g' | 'fat_g' | Ts
      >;
      water_entries: Table<WaterEntryRow, 'id' | Common | Ts>;
      shopping_lists: Table<ShoppingListRow, 'id' | Common | 'items' | Ts | 'updated_at'>;
      chat_messages: Table<ChatMessageRow, 'id' | Common | 'recipe' | Ts>;
      substitutions: Table<SubstitutionRow, 'id' | Common | 'section' | 'note' | 'items' | 'position'>;
      ai_usage: Table<AiUsageRow, Common | 'requests' | 'input_tokens' | 'output_tokens'>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      meal_slot: MealSlot;
      sex: Sex;
      goal: Goal;
      diary_kind: DiaryKind;
      recipe_origin: RecipeOrigin;
      target_method: TargetMethod;
      chat_role: ChatRole;
    };
    CompositeTypes: Record<never, never>;
  };
}
