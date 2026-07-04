# GangApp — Registre économique GTA RP

Application web full stack pour gérer les prix des gangs d'un serveur GTA RP :
gangs illimités, catégories personnalisables, items (nom / prix / description),
utilisateurs avec rôles, synchronisation en temps réel entre tous les postes
connectés, et historique complet des modifications.

**Base de données : PostgreSQL**, pour des données persistantes en production
(notamment sur Render, où le disque d'un service web est éphémère à chaque
redéploiement — contrairement à une base PostgreSQL managée, qui survit aux
redéploiements du code).

## Stack technique

| Couche         | Techno                                   |
|----------------|-------------------------------------------|
| Backend        | Node.js + Express                         |
| Base de données| PostgreSQL (via `pg`, driver officiel, aucune compilation native) |
| Auth           | JWT (`jsonwebtoken`) + mots de passe hashés (`bcryptjs`) |
| Temps réel     | Socket.io                                  |
| Frontend       | HTML/CSS/JS natif (aucun framework, connecté à l'API) |

## Migration depuis la version SQLite

Ce projet utilisait auparavant SQLite (`better-sqlite3`, fichier local). Cette
version passe entièrement à PostgreSQL, **sans perte de fonctionnalité** :
toutes les routes API, les rôles, le temps réel Socket.io, la recherche et
l'audit log fonctionnent à l'identique — seule la couche de stockage change.

**Si vous avez déjà des données dans l'ancienne base SQLite** (`data/gangapp.db`),
un script d'import est fourni pour les récupérer sans rien perdre :

```bash
# 1. Dependance temporaire, uniquement pour lire l'ancien fichier SQLite
npm install better-sqlite3 --no-save

# 2. Assurez-vous que DATABASE_URL (dans .env) pointe vers la nouvelle base
#    PostgreSQL, deja migree (npm start l'aura fait au premier lancement)

# 3. Lancez l'import (idempotent : peut être relancé sans dupliquer les données)
OLD_SQLITE_PATH=./data/gangapp.db node server/db/importFromSqlite.js

# 4. Une fois vérifié, vous pouvez retirer la dépendance temporaire
npm uninstall better-sqlite3
```

Le script réinjecte utilisateurs, gangs, catégories, items et historique en
conservant leurs identifiants d'origine, avec `ON CONFLICT DO NOTHING` : le
relancer par erreur ne duplique et n'écrase jamais rien.

## Politique de non-perte de données

**Règle absolue de ce projet : aucune mise à jour du code ne doit jamais supprimer,
réinitialiser ou recréer la base de données existante.** C'est appliqué
structurellement, pas seulement une intention :

- Le schéma est géré par un **système de migrations versionnées** dans
  `server/db/migrations/` (`001_init_schema.js`, `002_...`, etc.), et non par un
  script SQL unique rejoué à chaque démarrage.
- Chaque migration n'est **exécutée qu'une seule fois** : le runner
  (`server/db/migrate.js`) tient un registre (table `schema_migrations`) de ce
  qui a déjà été appliqué, et ignore les migrations déjà passées à chaque
  redémarrage — y compris après un redéploiement complet sur Render.
- Toute migration doit être **strictement additive** : `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Un
  `DROP TABLE`, un `DELETE FROM` sans clause `WHERE` précise, ou une recréation de
  table qui ferait perdre des lignes existantes n'ont **jamais leur place** dans
  une migration.
- Chaque migration s'exécute dans une **transaction PostgreSQL** (`BEGIN` /
  `COMMIT`, `ROLLBACK` automatique en cas d'erreur) : aucune modification
  partielle possible, et le serveur s'arrête proprement plutôt que de démarrer
  avec un schéma incohérent.
- Avant toute migration en attente, une **sauvegarde JSON** de toutes les tables
  est créée automatiquement dans `data/backups/` (voir `server/db/backup.js`).
  Une sauvegarde manuelle est possible à tout moment avec `npm run backup`.
- En production sur Render, la protection principale reste les **sauvegardes
  natives de votre plan PostgreSQL** (voir section Render ci-dessous) : les
  sauvegardes JSON de ce projet sont un filet de sécurité applicatif
  complémentaire, pas un remplacement.

### Ajouter une nouvelle fonctionnalité qui touche à la structure des données

1. **Ne jamais modifier** un fichier de migration déjà commité/déployé.
2. Copier `server/db/migrations/_TEMPLATE.example.js` en `00X_description.js`
   (X = prochain numéro), avec une opération additive et idempotente.
3. Adapter les routes (`server/routes/*.js`) pour lire/écrire la nouvelle colonne,
   sans toucher aux colonnes existantes.
4. Tester d'abord sur une base PostgreSQL locale ou de développement séparée
   (variable `DATABASE_URL` différente), jamais directement en production.
5. Au déploiement, la migration s'applique automatiquement au démarrage suivant
   — aucune commande manuelle requise, et les gangs/catégories/items existants
   restent intacts.

## Installation en local

Prérequis : **Node.js 18+** et un serveur **PostgreSQL** accessible (local, Docker,
ou distant).

### Option A — PostgreSQL via Docker (le plus simple)

```bash
docker run --name gangapp-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=gangapp \
  -p 5432:5432 -d postgres:16
```

### Option B — PostgreSQL installé nativement

Créez une base vide nommée `gangapp` avec l'utilisateur de votre choix.

### Puis, dans les deux cas :

```bash
# 1. Dézippez le projet puis placez-vous dedans
cd gangapp

# 2. Installez les dépendances
npm install

# 3. Créez votre fichier de configuration
cp .env.example .env
# ouvrez .env et renseignez au minimum : JWT_SECRET, DATABASE_URL, ADMIN_PASSWORD
# (la valeur par defaut de DATABASE_URL correspond a l'option Docker ci-dessus)

# 4. Lancez le serveur
npm start
```

Au premier démarrage, les tables sont créées automatiquement dans PostgreSQL
(via les migrations), et un compte **admin** est créé à partir des identifiants
définis dans `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

Ouvrez ensuite **http://localhost:3000**, connectez-vous avec ce compte admin,
et commencez à créer vos gangs.

> Pour le développement avec rechargement automatique : `npm run dev`.

## Déploiement sur Render

### Option A — Déploiement en un clic avec `render.yaml` (recommandé)

Ce projet inclut un **blueprint Render** (`render.yaml` à la racine) qui
provisionne automatiquement :
- un service web Node.js (build `npm install`, démarrage `npm start`),
- une base **PostgreSQL managée**, câblée automatiquement au service web via la
  variable `DATABASE_URL` (aucune configuration manuelle de connexion),
- un `JWT_SECRET` généré aléatoirement.

Étapes :
1. Poussez ce projet sur un dépôt GitHub/GitLab.
2. Sur Render : **New > Blueprint**, sélectionnez le dépôt.
3. Render détecte `render.yaml` et propose de créer les deux ressources
   (base + service web). Validez.
4. Render vous demandera de définir `ADMIN_PASSWORD` (laissé volontairement
   vide dans le blueprint pour ne jamais committer un mot de passe par défaut).
5. Déployez. Au premier démarrage, les migrations s'exécutent automatiquement
   et le compte admin est créé.

### Option B — Configuration manuelle

1. Créez une base **PostgreSQL** sur Render (Dashboard → New → PostgreSQL).
2. Copiez son **Internal Database URL** (si le service web sera dans la même
   région Render) ou l'**External Database URL** sinon.
3. Créez un **Web Service** Render pointant sur ce dépôt :
   - Build command : `npm install`
   - Start command : `npm start`
4. Dans les variables d'environnement du service web, définissez :
   - `DATABASE_URL` = l'URL copiée à l'étape 2
   - `JWT_SECRET` = une longue chaîne aléatoire
   - `JWT_EXPIRES_IN` = `12h` (ou autre)
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` = vos identifiants admin initiaux
   - `NODE_ENV` = `production`
5. Déployez.

### Points d'attention Render

- **Plan gratuit PostgreSQL** : Render applique des limites (expiration après une
  période d'inactivité prolongée, quota de stockage) qui évoluent régulièrement —
  vérifiez les conditions actuelles sur le tableau de bord Render avant de
  compter dessus pour des données de production durables. Pour un serveur RP
  actif, un plan payant avec sauvegardes automatiques est recommandé.
- **Sauvegardes natives** : les plans PostgreSQL payants de Render incluent des
  sauvegardes automatiques point-in-time. Activez/vérifiez cette option dans le
  dashboard de votre base — c'est la protection la plus fiable en production,
  en complément du système de migrations et du script `npm run backup` de ce
  projet.
- **SSL** : `server/db/pool.js` active automatiquement TLS pour toute connexion
  qui n'est pas vers `localhost` (donc automatiquement sur Render), avec
  `rejectUnauthorized:false` — c'est la configuration standard recommandée par
  Render pour ses certificats managés.
- **Redémarrages** : à chaque redéploiement, le service web redémarre (disque
  éphémère), mais la base PostgreSQL managée n'est pas touchée : vos gangs,
  catégories, items et utilisateurs restent intacts.

## Rôles utilisateurs

| Rôle     | Voir les gangs | Créer/modifier/supprimer gangs, catégories, items | Gérer les utilisateurs | Voir l'audit log |
|----------|:---:|:---:|:---:|:---:|
| `admin`  | ✅ | ✅ | ✅ | ✅ |
| `staff`  | ✅ | ✅ | ❌ | ✅ |
| `viewer` | ✅ | ❌ (lecture seule) | ❌ | ❌ |

Seul un `admin` peut créer de nouveaux comptes (bouton engrenage-utilisateurs dans la
barre latérale de l'app). Il n'y a pas d'auto-inscription : c'est volontaire, pour un
outil interne de serveur RP où l'accès doit rester contrôlé.

Les rôles `admin` et `staff` peuvent renommer un gang (icône crayon sur sa carte dans
la barre latérale) ou une catégorie (icône crayon dans son en-tête) via une édition
inline — le changement est validé côté serveur (unicité du nom) et diffusé
instantanément à tous les clients connectés via Socket.io.

## Structure des données

```
Gang
 ├─ id, name, color, created_by, created_at, updated_at
 └─ Categories[]
     ├─ id, name
     └─ Items[]
         ├─ id, name, price, description
```

Stocké en PostgreSQL avec suppression en cascade (`ON DELETE CASCADE`) :
supprimer un gang supprime ses catégories et leurs items ; supprimer une
catégorie supprime ses items.

## API REST

Toutes les routes (sauf `/api/auth/login`) nécessitent un header :
`Authorization: Bearer <token>`

### Authentification
| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Connexion, renvoie `{ token, user }` |
| GET  | `/api/auth/me` | connecté | Infos de l'utilisateur courant |
| GET  | `/api/auth/users` | admin | Liste des comptes |
| POST | `/api/auth/users` | admin | Créer un compte `{ username, password, role }` |
| PUT  | `/api/auth/users/:id` | admin | Modifier rôle / mot de passe |
| DELETE | `/api/auth/users/:id` | admin | Supprimer un compte |

### Gangs (imbrique automatiquement categories + items)
| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/api/gangs` | connecté | Liste complète de tous les gangs |
| GET | `/api/gangs/:id` | connecté | Un gang avec ses catégories/items |
| POST | `/api/gangs` | admin, staff | Créer `{ name, color? }` |
| PUT | `/api/gangs/:id` | admin, staff | Renommer / changer couleur `{ name?, color? }` |
| DELETE | `/api/gangs/:id` | admin | Supprimer (cascade) |

### Catégories
| Méthode | Route | Rôle requis |
|---|---|---|
| POST | `/api/gangs/:gangId/categories` | admin, staff |
| PUT | `/api/gangs/:gangId/categories/:catId` | admin, staff — renommer `{ name }` |
| DELETE | `/api/gangs/:gangId/categories/:catId` | admin, staff |

### Items
| Méthode | Route | Rôle requis |
|---|---|---|
| POST | `/api/gangs/:gangId/categories/:catId/items` | admin, staff |
| PUT | `/api/gangs/:gangId/categories/:catId/items/:itemId` | admin, staff |
| DELETE | `/api/gangs/:gangId/categories/:catId/items/:itemId` | admin, staff |

### Bonus
| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| GET | `/api/search?q=terme` | connecté | Recherche server-side (`ILIKE`, insensible à la casse) sur nom/description des items, tous gangs confondus |
| GET | `/api/export` | connecté | Export JSON complet de la base |
| GET | `/api/audit-log?limit=200` | admin, staff | Historique des modifications |
| GET | `/api/health` | public | Vérification que le serveur tourne |

## Temps réel (Socket.io)

À chaque création/modification/suppression via l'API, le serveur émet un événement
à tous les clients connectés :
- `gang:created`
- `gang:updated` (utilisé aussi pour les changements de catégories/items, qui renvoient le gang complet à jour)
- `gang:deleted`

Le frontend écoute ces événements et met à jour l'affichage instantanément, sans
recharger la page — utile si plusieurs membres du staff modifient les prix en même
temps.

La connexion Socket.io est authentifiée avec le même JWT que l'API REST.

## Audit log

Chaque action de création, modification ou suppression (gangs, catégories, items,
utilisateurs) et chaque connexion sont enregistrées dans la table `audit_log` avec
l'auteur, la date, et le détail de l'action. Consultable via l'icône horloge dans la
barre latérale (rôle `admin` ou `staff`).

## Sécurité — à lire avant mise en production

- **Changez `JWT_SECRET`** dans `.env` (ou laissez `render.yaml` en générer un
  automatiquement sur Render) : la valeur par défaut n'est pas sûre.
- **Changez `ADMIN_PASSWORD`** avant le premier démarrage, ou changez le mot de passe
  du compte admin juste après (via la modale utilisateurs).
- Le fichier `.env` ne doit jamais être commité dans un dépôt Git public.
- PostgreSQL sur Render est servi en TLS (voir section Render ci-dessus) ; en local,
  le trafic HTTP de l'application elle-même doit rester derrière HTTPS pour toute
  exposition sur Internet (Render gère cela automatiquement pour le service web).
- Les mots de passe sont hashés avec bcrypt (jamais stockés en clair).
- Le token JWT est stocké côté client en `sessionStorage` (effacé à la fermeture de
  l'onglet), pas en cookie, pour limiter les risques CSRF — c'est un choix simple
  adapté à un outil interne d'équipe RP.

## Arborescence du projet

```
gangapp/
├── package.json
├── .env.example
├── render.yaml                # blueprint Render (web service + PostgreSQL)
├── server/
│   ├── index.js               # point d'entrée: Express + Socket.io + demarrage async
│   ├── db/
│   │   ├── pool.js            # pool de connexions PostgreSQL (pg)
│   │   ├── database.js        # orchestrateur: applique les migrations au demarrage
│   │   ├── migrate.js         # runner de migrations (idempotent, transactionnel)
│   │   ├── migrations/
│   │   │   ├── 001_init_schema.js      # schéma initial (additif)
│   │   │   └── _TEMPLATE.example.js    # modèle pour les futures migrations
│   │   ├── backup.js          # sauvegarde JSON de toutes les tables
│   │   ├── seed.js            # création du compte admin initial
│   │   ├── auditLog.js        # utilitaire d'écriture de l'historique
│   │   └── importFromSqlite.js # import ponctuel depuis l'ancienne base SQLite
│   ├── middleware/
│   │   └── auth.js            # vérification JWT + contrôle des rôles
│   └── routes/
│       ├── auth.js            # login, gestion des utilisateurs
│       ├── gangs.js           # CRUD gangs/catégories/items
│       └── misc.js            # recherche, export, audit log
└── public/                    # frontend statique servi par Express
    ├── index.html
    ├── css/style.css
    └── js/
        ├── api.js             # wrapper fetch() avec JWT
        └── app.js              # rendu, événements, Socket.io client
```

## Étendre le système

- **Nouvelle catégorie par défaut** : ajoutez-la dans le tableau des `preset-chip`
  dans `public/index.html`/`app.js` — ou laissez les utilisateurs staff en créer
  librement, c'est déjà supporté sans limite.
- **Devise/format de prix** : la fonction `fmtPrice()` dans `public/js/app.js`
  centralise l'affichage (`$` + séparateur de milliers français).
- **Champ supplémentaire sur un item** (ex: stock, image) : ajoutez une migration
  additive dans `server/db/migrations/` (voir `_TEMPLATE.example.js`), puis mettez à
  jour les routes POST/PUT de `server/routes/gangs.js`, puis le formulaire
  correspondant côté frontend. Ne modifiez jamais `pool.js`/`database.js` pour
  ajouter des colonnes directement — voir la section *Politique de non-perte de
  données*.
- **Revenir à un autre SGBD (MySQL, etc.)** : la seule couche à réécrire est
  `server/db/*.js` (pool de connexion, migrations, requêtes SQL) ; les routes
  (`server/routes/*.js`) orchestrent la logique métier autour de ces fonctions et
  n'ont pas besoin de changer en profondeur si vous gardez la même forme de
  données.
