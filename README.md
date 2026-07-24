# PLCHB Pronostic

Application de pronostics handball pour le club PLCHB (Plaisir Les Clayes Handball).

## Stack technique

- React + Vite
- Tailwind CSS
- Supabase (base de données partagée : matchs, pronostics, licenciés, points bonus)

## 1. Installer les dépendances

```bash
npm install
```

## 2. Variables d'environnement

Copie `.env.example` en `.env` (déjà pré-rempli avec le projet Supabase du club) :

```bash
cp .env.example .env
```

## 3. Lancer en local

```bash
npm run dev
```

## 4. Mettre sur GitHub

```bash
git init
git add .
git commit -m "Première version de l'appli"
git branch -M main
git remote add origin https://github.com/<ton-compte>/plchb-prono.git
git push -u origin main
```

(Crée d'abord un dépôt vide sur github.com avant le `git remote add`.)

## 5. Déployer sur Vercel

1. Va sur vercel.com → **Add New → Project**.
2. Choisis **Import Git Repository** et sélectionne `plchb-prono`.
3. Vercel détecte automatiquement Vite — ne change rien à la configuration du build.
4. **Avant de cliquer sur Deploy**, ouvre la section **Environment Variables** et ajoute :
   - `VITE_SUPABASE_URL` = `https://cnocallewutxaqsxbned.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `sb_publishable_eCrdmGWNBCXxVD_mN2_Nqw_lHHuHLum`
5. Clique **Deploy**. L'appli est en ligne quelques secondes plus tard.

Chaque futur `git push` sur la branche `main` redéploie automatiquement le site.

## Base de données Supabase

Le projet Supabase contient 4 tables : `matches`, `predictions`, `registered_users`, `bonus_points`.
Elles sont en accès public (lecture/écriture) car l'appli n'a pas de système d'authentification serveur —
même niveau de confiance que la version précédente (artefact Claude), protégée uniquement par le code
admin (`coach2026`, modifiable dans `src/App.jsx`, constante `ADMIN_PASS`).
