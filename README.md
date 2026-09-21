# MenuVibe

Prywatna aplikacja na Androida: plan diety, liczenie kalorii, kontrola redukcji i czat z Claude.

Stack: Angular 22 + Ionic 9 + Capacitor 8, backend Supabase (Postgres, Auth, Edge Functions).

## Struktura

| Ścieżka | Zawartość |
| --- | --- |
| `src/app/core` | Klient Supabase, logowanie, typy bazy |
| `src/app/pages` | Ekrany (zakładki: Dziś, Tydzień, Przepisy, Ruch, Profil; czat pod przyciskiem ✦) |
| `supabase/migrations` | Schemat bazy z RLS |
| `supabase/functions` | Edge Functions (czat z Claude – etap 5) |
| `data/foods.json` | Tabela ok. 120 produktów (kcal i makro na 100 g) do liczenia zamienników |
| `data/recipes.json` | 248 przepisów wyciągniętych z PDF-ów dietetyczek |
| `tools/pdf-import` | Parser PDF → `recipes.json` (Python + pdfplumber) |
| `android` | Projekt Android Studio (Capacitor) |

## Pierwsze uruchomienie

Wymagania: Node 22.22.3+ (lub 24), Android Studio z JDK 21, Supabase CLI.

```bash
npm install
npm i -g supabase          # jeśli jeszcze nie masz
supabase login
supabase link --project-ref taogexnjmdntnniolute   # poprosi o hasło do bazy
supabase db push           # tworzy tabele i reguły RLS
```

Konto: przy pierwszym uruchomieniu wybierz „Nie masz konta? Załóż je”. Baza przyjmuje tylko
pierwsze konto (od razu potwierdzone), a każdą kolejną rejestrację odrzuca.

## Uruchomienie w przeglądarce

```bash
npm start      # http://localhost:4200
```

## Instalacja na telefonie (PWA) – zalecane

Aplikacja działa jako instalowalna strona (PWA) hostowana na Netlify. Każdy `git push` publikuje nową wersję,
a telefon pokazuje „Jest nowa wersja – Odśwież”.

1. Utwórz **prywatne** repozytorium na GitHubie (bez README) i wypchnij kod:
   ```bash
   git branch -M main
   git remote add origin https://github.com/<login>/menuvibe.git
   git push -u origin main
   ```
2. Na [app.netlify.com](https://app.netlify.com) zaloguj się przez GitHub → **Add new site → Import an existing project →
   GitHub** → wybierz repozytorium → **Deploy**. Ustawienia buildu są w `netlify.toml`.
3. Na telefonie otwórz adres strony (np. `https://menuvibe-xyz.netlify.app`) w **Chrome** → menu ⋮ → **Zainstaluj aplikację**.

Skaner kodów w PWA używa aparatu przez przeglądarkę (BarcodeDetector, a gdzie go brak – ZXing w WebAssembly).

## APK na telefon (opcjonalnie)

```bash
npm run android            # build + sync + otwiera Android Studio
```

W Android Studio: **Build → Generate App Bundles or APKs → Generate APKs**.
Plik trafi do `android/app/build/outputs/apk/debug/app-debug.apk` – wyślij go na telefon i zainstaluj
(trzeba zezwolić na instalację z nieznanych źródeł). Przy telefonie podłączonym kablem wystarczy **Run ▶**.

Po każdej zmianie w kodzie: `npm run android:sync` i ponowne uruchomienie z Android Studio.

## Czat z Claude (Edge Function)

Klucz Anthropic trzymamy wyłącznie w sekretach Supabase:

```bash
supabase db push                                   # migracja z limitem zapytań
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # klucz z console.anthropic.com
supabase functions deploy ai-chat
```

Opcjonalnie: `supabase secrets set ANTHROPIC_MODEL=<model>` (domyślnie `claude-sonnet-4-5`)
i `AI_DAILY_LIMIT=40` (dzienny limit pytań). Testy logiki funkcji: `deno test supabase/functions/ai-chat`.

## Jak liczone są kalorie

- **Przemiana spoczynkowa (BMR):** Mifflin-St Jeor – najdokładniejszy wzór dla osób bez otyłości
  (ok. 82% wyników w granicach ±10% pomiaru). Gdy podasz procent tkanki tłuszczowej, aplikacja
  przechodzi na Katch-McArdle (370 + 21,6 × masa beztłuszczowa).
- **Zapotrzebowanie (TDEE)** liczone jest ze składników, a nie z jednego mnożnika „aktywność”:
  `BMR × tryb dnia (1,15–1,4) + kroki + treningi`.
  Kroki: 0,45 kcal na 1000 kroków na kg masy, licząc powyżej 2500 kroków.
  Treningi: `(MET − 1) × 3,5 × kg / 200 × minuty`, netto (bez energii spoczynkowej), rozłożone na tydzień.
- **Zapotrzebowanie z danych:** gdy masz min. 10 dni dziennika i 4 ważenia z co najmniej 14 dni,
  aplikacja liczy `średnie spożycie − zmiana masy × 7700 kcal/kg / dzień`. Trend masy liczy regresją,
  żeby wahania wody nie psuły wyniku. Wynik jest mieszany ze wzorem (waga rośnie z liczbą dni z danymi,
  najwyżej 0,8) i nigdy nie odchyla się o więcej niż 25% od wzoru.
- **Cel:** zapotrzebowanie + korekta z tempa (% masy ciała na tydzień × 7700 / 7). Deficyt najwyżej 25%
  zapotrzebowania, cel nigdy poniżej BMR ani poniżej 1500 kcal (mężczyźni) / 1200 kcal (kobiety).
- **Ruch:** kroki i treningi z zakładki Ruch zastępują deklarację z profilu, gdy jest co najmniej
  5 dni z wpisami w ostatnich 14. Trening z zegarka (kcal) ma pierwszeństwo przed wzorem z METów.
- **Przeliczanie:** raz w tygodniu, w wybrany dzień, zmiana najwyżej o 100 kcal i 10% naraz.

Źródła: Frankenfield i in. 2005 (dokładność wzorów BMR), FAO/WHO/UNU 2001 (PAL),
Compendium of Physical Activities (METy), Hall i in. / NIDDK Body Weight Planner (bilans energii,
adaptacja metaboliczna).

## Zamienniki składników

W przepisie dotknięcie składnika pokazuje produkty z tej samej grupy (owoce, kasze, nabiał, mięso i ryby…)
wraz z gramaturą przeliczoną tak, żeby zgadzały się kalorie: `gramy × kcal/100 g oryginału ÷ kcal/100 g zamiennika`,
zaokrąglone do 5 g. Przy każdej pozycji widać różnicę białka, węglowodanów i tłuszczu. Dane w `data/foods.json`.

Miar domowych („2 łyżki”) nie pokazujemy – wszystko ważymy.

## Testy

```bash
npm test
```
