# L'Anti-Moldu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App web mobile FR/EN « mentor + carnet » de discipline pour un groupe d'amis, déployée sur Vercel.

**Architecture:** Une page statique (`index.html` + `content.js` + `logic.js`, scripts classiques posant des globales) qui marche 100 % hors ligne, plus trois Vercel Functions ESM (`api/coach.js`, `api/tasks.js`, `api/state.js`) pour Gemini et le classement Upstash. Toute la logique métier est dans `logic.js` en fonctions pures, testée avec `node:test`.

**Tech Stack:** HTML/CSS/JS vanilla, Node ≥ 20 (fetch natif), `node:test`, Vercel Functions, Gemini REST, Upstash Redis REST. Zéro dépendance npm.

**Spec:** `anti-moldu/SPEC.md` (source de vérité — chaque agent la lit en entier avant de coder).

## Global Constraints

- Aucun framework, aucun build, aucune dépendance npm dans le projet. Outils de test (Playwright) uniquement hors projet, dans le scratchpad.
- `package.json` = `{"name":"anti-moldu","private":true,"type":"module","engines":{"node":">=20"}}`.
- `content.js` / `logic.js` : scripts classiques, pas de `export`, posent `globalThis.AM_CONTENT` / `globalThis.AM_LOGIC`.
- Noms, structures, contrats : exactement ceux de SPEC.md §7. Ne rien renommer.
- Chaque agent ne modifie que ses fichiers ; il signale tout besoin ailleurs.
- Dates `YYYY-MM-DD` heure locale ; calculs internes en UTC minuit.
- Pas de regex lookbehind (`(?<=`, `(?<!`) nulle part côté client.
- Jamais `innerHTML` avec du texte utilisateur ou IA.
- Le groupe ne reçoit jamais : titres de tâches, notes, objectifs, profil.
- Aucun nom de personne réelle dans les textes ou prompts.
- `node --test` depuis `anti-moldu/` lance tous les tests.

## Review Focus

1. **Changement d'heure / fuseau** (passage à l'heure d'hiver fin octobre) : `addDays("2026-10-24", 2) === "2026-10-26"`, `daysBetween("2026-10-24","2026-10-26") === 2`. → test dans Task 2.
2. **App laissée ouverte après minuit** : au retour sur l'onglet (`visibilitychange`) ou au changement de date, l'app réévalue le rang et affiche le bon jour. → scénario Playwright Task 4 (horloge simulée).
3. **État corrompu ou ancien** (JSON invalide, champs manquants, import d'un fichier bidon) : l'app démarre, normalise ou repart de zéro avec un message. → scénario Playwright Task 4.
4. **Retour après 3 semaines d'absence** : `evaluateRank` traite ≤ 120 jours, une marche par jour, pénalités appliquées, < 200 ms. → test Task 2.
5. **Profil groupe malveillant ou cassé** (nom de 500 caractères, HTML dans le nom, champ `tasks` en plus, groupe `abc`) : le serveur borne, filtre par liste blanche, refuse les codes invalides (400), l'UI affiche en `textContent`. → test Task 3 + Task 4.

---

### Task 1: Contenu (`content.js`) — Agent 1

**Files:**
- Create: `anti-moldu/content.js`
- Test: `anti-moldu/tests/content.test.mjs`

**Interfaces:**
- Produces: `globalThis.AM_CONTENT` conforme à SPEC §7.4 (inclut `boosts`, `boostsAllDone`, `coachFallback.*.boost`). Clés `ui` utilisées par l'UI : l'agent 4 peut en ajouter dans `index.html`, donc l'agent 1 livre un jeu large (onglets, carnet, mentor, groupe, réglages, cartes, erreurs, hors ligne, toasts).
- Tâches de parcours : `pathStep` 1/2/3, `minRank` 0/1/6, valeurs exactes du tableau SPEC §3.7, une version par type viepro (`vieProType` = `business|ecole|travail`), les autres piliers `vieProType: null`.

- [ ] **Step 1: Écrire `tests/content.test.mjs`** : `await import("../content.js")`, puis assertions :
  - `pillars` ids = `["corps","focus","viepro","savoir","lien","ame"]` ; `ranks.length === 5` ; `emotions.length === 7` ; `diagnostic.length === 24` avec 4 par pilier et 6 options fr/en chacune.
  - `Object.keys(ui.fr).sort()` deep-equal `Object.keys(ui.en).sort()` ; idem pour `onboarding` (11 étapes).
  - `taskLibrary.length >= 90`, ids uniques, `freq` valide (daily | every_n_days n 2–7 | per_week n 1–7), difficulty 1–5, minutes 1–240, ≥ 3 tâches `minRank 0` par pilier, ≥ 6 tâches par type viepro, aucune tâche « bilan ».
  - Pour chaque pilier × étape (et chaque type viepro) : exactement une tâche `pathStep` avec freq/difficulty/minutes du tableau §3.7 (ex. corps/1 = every_n_days 2, 2, 10 ; corps/2 = per_week 3, 4, 60).
  - `coachFallback.{fr,en}.{morning,boost,bilan,avis,regression,chat}.length >= 8` ; `boosts.{fr,en}.length >= 30` ; `boostsAllDone.{fr,en}.length >= 10` ; `oath.fr` et `oath.en` non vides.
- [ ] **Step 2:** `node --test tests/content.test.mjs` → FAIL (fichier absent).
- [ ] **Step 3:** Écrire `content.js` : ton direct, cru, tutoiement, phrases courtes. Diagnostic factuel (sujets de SPEC/prompt Agent 1). Une ligne du `chat` de secours invite doucement à parler à quelqu'un de confiance.
- [ ] **Step 4:** `node --test tests/content.test.mjs` → PASS.

### Task 2: Logique (`logic.js`) — Agent 2

**Files:**
- Create: `anti-moldu/logic.js`
- Test: `anti-moldu/tests/logic.test.mjs`
- Hors projet : `<scratchpad>/simulate.mjs`

**Interfaces:**
- Produces: `globalThis.AM_LOGIC` avec exactement les membres de SPEC §7.3 (incl. `PILLARS`, `daysSinceStart`, `todayProgress`).
- Événements de rang : `{type:"up"|"down", date, from, to}` ; `evaluateRank` met à jour `rank.index`, `rank.lastEvalDate`, `rankHistory`, `pendingRegression` dans l'état renvoyé (copie).

- [ ] **Step 1: Écrire les tests** (`node:test`, `assert/strict`), au minimum :
  - `taskValue(2,10)` → `{points:16,penalty:22}` ; `(4,60)` → `40/28` ; `(1,15)` → `10/14` ; `(4,180)` → `60/42`.
  - Dates : Review Focus #1 ; `dayIndex("2026-10-26") === 0` (lundi) ; `isoWeekStart("2026-11-01") === "2026-10-26"`.
  - `isDue` : daily bornes createdAt inclus / deactivatedAt exclu ; every_n_days 2 (J0 oui, J1 non, J2 oui).
  - `computePoints` : usure (done à 29 j → ×1, 30 j → ×0,75, 60 j → ×0,5) ; pénalité jour clos ; aujourd'hui pas pénalisé via `livePoints` ; per_week semaine close (n=3, 1 fait → −2×penalty) ; prorata (créée jeudi, n=3 → n_eff = ceil(3×4/7) = 2) ; done au-delà de n_eff ignoré ; done sur jour non dû ignoré ; minimum 0 ; seedPoints ajoutés.
  - `computeDiscipline` : 14 jours, jamais avant startDate, `null` si rien de dû, per_week selon §4.5.
  - `computeTargetIndex` : (0,null,0) → 0 ; (1400,60,14) → 3 ; (16000,90,90) → 12 ; (99999,100,13) → 2 ; (1400,59,14) → 2.
  - `evaluateRank` : une marche par jour max ; pas de descente si `days ≤ 7` ; jamais sous startIndex si `days < 14` ; `pendingRegression` posé ; max 120 jours ; Review Focus #4 (absence 21 jours, < 200 ms).
  - `applyDownEvents` : désactive les plus récentes d'abord (`deactivatedAt = today`), jamais la dernière active d'un pilier, jamais `system`.
  - `startIndexFromDiagnostic` : total 47 → index 0 / 0 pt ; 48 → 1 / 420 ; 71 → 1 ; 72 → 2 / 840 ; 120 → 2.
  - `canMark` : aujourd'hui et hier oui, avant-hier et demain non. `toggleDone` : ajoute puis retire ; ne mute pas l'argument (deep-freeze de l'entrée).
  - `computeStreak` : 80 % requis, jours sans dû neutres.
  - `nextUnlockPillar` : 1 tâche/pilier → `corps` ; puis `focus` ; … reproduit les 12 déblocages de §3.7 ; ignore system et inactives.
  - `todayProgress` : compte daily/every_n_days dus aujourd'hui et faits.
- [ ] **Step 2:** `node --test tests/logic.test.mjs` → FAIL.
- [ ] **Step 3:** Écrire `logic.js` (IIFE, `globalThis.AM_LOGIC = {...}`), toutes fonctions pures.
- [ ] **Step 4:** `node --test tests/logic.test.mjs` → PASS.
- [ ] **Step 5: Simulation** (`<scratchpad>/simulate.mjs`, charge `logic.js`) : utilisateur parfait, départ D- (diagnostic < 48), 6 tâches d'étape 1 (viepro business), à chaque slot libre le lendemain il prend la tâche de parcours du pilier `nextUnlockPillar`, per_week faits en début de semaine. Rapporter le jour d'atteinte de C, B, A, S et la marge points/jours. Refaire avec départ D+ (840 pts). Utilisateurs à 80 % et 60 % (ratés déterministes, ex. jour % 5 === 4 pour 80 %) : rang aux jours 30/60/90/120. Ne pas modifier `THRESHOLDS` : rapporter les écarts.

### Task 3: Serveur (`api/*`) — Agent 3

**Files:**
- Create: `anti-moldu/api/_lib.js`, `anti-moldu/api/coach.js`, `anti-moldu/api/tasks.js`, `anti-moldu/api/state.js`, `anti-moldu/package.json`
- Test: `anti-moldu/tests/api.test.mjs` (sans réseau, `globalThis.fetch` simulé, Map en mémoire pour Upstash)

**Interfaces:**
- Produces: routes de SPEC §7.5 exactement. `_lib.js` exporte `callGemini({system, user, temperature, maxOutputTokens, json})`, `parseJsonLoose(text)`, `redis(cmdArray)`, `taskValue(d,m)` (identique à logic.js), `clean(str, max)`, `sendJson(res, status, obj)`.
- Prompts : persona « mentor qui parle cru » SPEC §6.2, formats §6.1 (6 modes dont `boost`), `lastBilan` pour « ce qui a changé », données utilisateur dans `<context>`, `<history>`, `<message>`.

- [ ] **Step 1: Écrire `tests/api.test.mjs`** avec un faux `res` (`status()`, `setHeader()`, `json()`/`end()`) :
  - Gemini simulé : JSON valide → 200 ; JSON entre ```json → 200 ; texte quelconque pour tasks → 503 ; HTTP 500 → 503 `{error:"ai_unavailable"}` ; clé absente → 503 ; aucune clé ni trace dans le corps de réponse.
  - Vérifier que le body envoyé à Gemini contient `generationConfig.thinkingConfig.thinkingBudget === 0` pour `gemini-2.5-flash`.
  - `/api/tasks` propose : renvoie 3 tâches, `points`/`penalty` = `taskValue` serveur même si Gemini envoie d'autres points ; freq invalide / minutes 999 / titre 200 caractères bornés ou rejetés ; doublon de `existingTasks` retiré.
  - `/api/state` : POST puis GET → membre présent, trié rang puis points ; group `abc` → 400 ; nom 500 caractères tronqué à 30 ; champ `tasks` dans profile **absent** du stockage ; 51e membre → refusé ; accepte `KV_REST_API_*` comme `UPSTASH_*`.
  - Toutes routes : mauvaise méthode → 405 ; en-tête `Cache-Control: no-store`.
- [ ] **Step 2:** `node --test tests/api.test.mjs` → FAIL.
- [ ] **Step 3:** Écrire `_lib.js`, `coach.js`, `tasks.js`, `state.js`, `package.json`.
- [ ] **Step 4:** `node --test tests/api.test.mjs` → PASS.

### Task 4: Interface (`index.html`) — Agent 4

**Files:**
- Create: `anti-moldu/index.html`
- Hors projet : `<scratchpad>/ui-test/` (Playwright installé là, serveur statique Node, captures)

**Interfaces:**
- Consumes: `AM_CONTENT` (§7.4), `AM_LOGIC` (§7.3), routes §7.5. Si `content.js`/`logic.js` ne sont pas encore livrés, coder contre les contrats.
- Toute clé `t("...")` doit exister dans `AM_CONTENT.ui.fr` et `.en` ; une clé manquante s'affiche comme la clé (jamais de crash) et est signalée à l'orchestrateur.

- [ ] **Step 1:** Charger le skill `frontend-design`, puis concevoir.
- [ ] **Step 2:** Écrire `index.html` : onboarding 11 étapes (§5.1), 5 onglets + engrenage (§5.2), carnet, toasts de boost, mentor (6 modes), groupe (todayDone/todayDue, aucun titre), réglages, bilan de l'âme, régression, montée. Règles : fetch relatif, timeout 25 s (12 s pour les propositions), non-JSON = hors ligne ; état normalisé au chargement ; `evaluateRank` + `applyDownEvents` à l'ouverture, sur `visibilitychange` et au changement de date ; cache des propositions vidé en fin d'onboarding ; POST groupe anti-rebond après chaque coche.
- [ ] **Step 3: Playwright 390×844** : onboarding complet FR, cocher une tâche (toast boost visible), écrire/modifier/supprimer une note, passer en EN, visiter tous les onglets, 0 erreur console. Variantes : API 404, API renvoie du HTML, API qui ne répond jamais, iframe sandbox, localStorage bloqué, localStorage corrompu (`"{oops"`), signatures « ayoub », « AYOUB », « Ayoub Bensalem », « Ayóub » (prénom « Ayoub »), horloge avancée d'un jour onglet ouvert, thème clair. Largeurs 360 et 430 : pas de défilement horizontal.
- [ ] **Step 4:** Regarder les captures, corriger ce qui est moche, serré ou qui déborde ; relancer jusqu'à 0 erreur.

### Task 5: Vérification indépendante — Agent 5

**Files:** correctifs minimaux là où il trouve un bug ; scripts hors projet dans `<scratchpad>/verify/`.

- [ ] **Step 1:** `node --test` depuis `anti-moldu/` → tout passe.
- [ ] **Step 2:** Audit des contrats : chaque `fetch` de `index.html` ↔ handlers ; chaque `AM_LOGIC.xxx` existe ; chaque `t("...")` existe en fr et en.
- [ ] **Step 3:** Serveur Node hors projet servant les fichiers + vrais handlers `/api`, Gemini simulé, Upstash = Map. Scénario : onboarding avec 6 tâches IA, créer un groupe, cocher, mot du matin, Bilan (5 sections), Ton avis (verdict), Boost, chat, note de carnet, 2e utilisateur rejoint ⇒ chacun voit l'autre ; vérifier que le stockage du groupe ne contient aucun titre de tâche ni note.
- [ ] **Step 4:** Régression : utilisateur en B- qui arrête tout ⇒ une marche par jour, désactivation des plus récentes, jamais la dernière d'un pilier.
- [ ] **Step 5:** Rapport : bugs corrigés, décisions produit à prendre.

### Task 6: README + déploiement guidé — Agent 6 / orchestrateur

**Files:**
- Create: `anti-moldu/README.md` (FR + EN, étapes §8 Agent 6 du prompt)

- [ ] **Step 1:** Écrire le README.
- [ ] **Step 2:** Guider l'utilisateur une étape à la fois (node -v → vercel install/login → vercel → clé Gemini + `vercel env add GEMINI_API_KEY` → Upstash via Storage → `vercel --prod` → test réel), en attendant son « ok » à chaque étape et en précisant « PowerShell, dans le dossier anti-moldu ».
