# L'Anti-Moldu

Un mentor qui parle cash, un carnet de notes et des tâches qui te rapportent (ou te coûtent) des points. Tu montes de D- à S, et ton groupe de potes voit si tu tiens, ce que tu as coché, et vous pouvez discuter.

*A blunt mentor, a notebook, and daily tasks that earn (or cost) you points. Climb from D- to S; your friends see whether you show up and what you checked off, and you can chat.*

---

## Français

### Ce qu'il y a dans le dossier
| Fichier | Rôle |
|---|---|
| `index.html` | L'app (écrans, styles, code) |
| `content.js` | Tous les textes FR/EN, le diagnostic, les tâches, les boosts |
| `logic.js` | Les règles : rangs, points, discipline |
| `api/` | Le serveur : mentor IA (Gemini), propositions de tâches, classement |
| `tests/` | Les tests (`node --test`) |
| `SPEC.md` | La spécification complète |

L'app marche **même sans serveur** (mode secours : messages du mentor préécrits, tâches de la bibliothèque, classement indisponible).

### Tester en local
Dans PowerShell, dans le dossier `anti-moldu` :
```
node --test
```
Pour voir l'app : ouvre `index.html` dans ton navigateur (mode secours), ou lance `vercel dev` après l'étape 3 ci-dessous pour avoir le serveur.

### Déployer sur Vercel (pas à pas)
Toutes les commandes se tapent **dans PowerShell, dans le dossier `anti-moldu`** (`cd C:\Users\<toi>\anti-moldu`).

1. **Vérifier Node** : `node -v` → doit afficher v20 ou plus.
2. **Installer Vercel** : `npm install -g vercel`
3. **Se connecter** : `vercel login` (choisis GitHub ou e-mail, valide dans le navigateur).
4. **Premier déploiement** : `vercel` → réponds avec les valeurs par défaut (Entrée à chaque question). Tu obtiens un lien de test.
5. **Clé IA Gemini** :
   - Va sur https://aistudio.google.com → *Get API key* → *Create API key*.
   - Puis : `vercel env add GEMINI_API_KEY` → colle la clé → coche **Production** (et Preview si tu veux).
   - Optionnel : `vercel env add GEMINI_MODEL` pour changer de modèle (défaut `gemini-flash-lite-latest`).
   - **Secours Groq** (recommandé) : clé gratuite sur https://console.groq.com → *API Keys*, puis `vercel env add GROQ_API_KEY`. Si Gemini ne répond pas, Groq (`openai/gpt-oss-120b`, modifiable avec `GROQ_MODEL`) prend le relais.
6. **Classement (Upstash Redis)** : sur https://vercel.com → ton projet → onglet **Storage** → **Create / Connect** → **Upstash Redis** (offre gratuite) → connecte-le au projet. Les variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` sont ajoutées toutes seules.
7. **Mise en ligne** : `vercel --prod` → c'est le lien à partager aux potes.
8. **Vérifier** : ouvre le lien sur ton téléphone, fais l'onboarding, crée un groupe. Le mot du mentor doit être personnalisé (avec ton prénom ou tes tâches), pas un message générique. Un pote rejoint avec le code → vous vous voyez au classement.

### Bon à savoir
- Pas de compte : tout est stocké sur ton téléphone. Change de téléphone ? **Réglages → Exporter**, puis Importer sur le nouveau.
- Ce que le groupe reçoit : prénom, rang, points, discipline, série, « x/y aujourd'hui », les tâches cochées aujourd'hui (titre + pilier), le total sur 7 jours, et les messages du chat de groupe (100 derniers, gardés 30 jours). Pas les notes ni le diagnostic.
- Protection : le classement ne montre jamais les identifiants (personne ne peut modifier la ligne d'un autre), et le serveur limite les appels (40 messages au mentor par heure et par connexion, 1000 appels IA par jour au total — modifiable avec `vercel env add AI_DAILY_LIMIT`). Au-delà, l'app passe en mode secours.
- Ce que l'IA reçoit : ton profil, tes tâches, tes 5 dernières notes, pour te répondre. Offre gratuite de Gemini : Google peut utiliser ces données pour améliorer ses modèles.

---

## English

### What's inside
| File | Role |
|---|---|
| `index.html` | The app (screens, styles, code) |
| `content.js` | All FR/EN copy, diagnostic, task library, boosts |
| `logic.js` | Rules: ranks, points, discipline |
| `api/` | Server: AI mentor (Gemini), task suggestions, leaderboard |
| `tests/` | Tests (`node --test`) |
| `SPEC.md` | Full specification |

The app **works without a server** (fallback mode: pre-written mentor lines, library tasks, leaderboard unavailable).

### Test locally
In PowerShell, inside the `anti-moldu` folder:
```
node --test
```
To see the app: open `index.html` in your browser (fallback mode), or run `vercel dev` after step 3 below to get the server too.

### Deploy to Vercel (step by step)
Type every command **in PowerShell, inside the `anti-moldu` folder**.

1. **Check Node**: `node -v` → v20 or higher.
2. **Install Vercel**: `npm install -g vercel`
3. **Log in**: `vercel login`
4. **First deploy**: `vercel` → accept the defaults. You get a preview link.
5. **Gemini AI key**:
   - Go to https://aistudio.google.com → *Get API key* → *Create API key*.
   - Then: `vercel env add GEMINI_API_KEY` → paste the key → tick **Production**.
   - Optional: `vercel env add GEMINI_MODEL` to change model (default `gemini-flash-lite-latest`).
   - **Groq backup** (recommended): free key at https://console.groq.com → *API Keys*, then `vercel env add GROQ_API_KEY`. If Gemini fails, Groq (`openai/gpt-oss-120b`, change with `GROQ_MODEL`) takes over.
6. **Leaderboard (Upstash Redis)**: on https://vercel.com → your project → **Storage** tab → **Create / Connect** → **Upstash Redis** (free plan) → connect to the project. `KV_REST_API_URL` / `KV_REST_API_TOKEN` are added automatically.
7. **Go live**: `vercel --prod` → share this link with your friends.
8. **Check**: open the link on your phone, complete onboarding, create a group. The mentor's line should be personal (your name or tasks), not generic. A friend joins with the code → you see each other on the leaderboard.

### Good to know
- No accounts: everything lives on your phone. New phone? **Settings → Export**, then Import.
- What the group receives: first name, rank, points, discipline, streak, "x/y today", tasks checked off today (title + pillar), the 7-day total, and group chat messages (last 100, kept 30 days). Not your notes or diagnostic.
- Protection: the leaderboard never exposes member ids (nobody can overwrite someone else's row), and the server rate-limits calls (40 mentor messages per hour per connection, 1000 AI calls per day overall — change with `vercel env add AI_DAILY_LIMIT`). Beyond that, the app falls back to offline mode.
- What the AI receives: your profile, tasks and last 5 notes, to answer you. On Gemini's free tier, Google may use this data to improve its models.
