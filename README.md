# MenuVibe

Prywatna aplikacja na Androida: plan diety, liczenie kalorii, kontrola redukcji i czat z Claude.

Stack: Angular 22 + Ionic 9 + Capacitor 8, backend Supabase (Postgres, Auth, Edge Functions).

## Struktura

| Ścieżka | Zawartość |
| --- | --- |
| `src/app/core` | Klient Supabase, logowanie, typy bazy |
| `src/app/pages` | Ekrany (zakładki: Dziś, Tydzień, Przepisy, Czat, Profil) |
| `supabase/migrations` | Schemat bazy z RLS |
| `supabase/functions` | Edge Functions (czat z Claude – etap 5) |
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

## Testy

```bash
npm test
```
