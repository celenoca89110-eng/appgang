# GangApp — Registre économique GTA RP

Application web full stack pour gérer les prix des gangs d'un serveur GTA RP :
gangs illimités, catégories personnalisables, items (nom / prix / description),
utilisateurs avec rôles, synchronisation en temps réel entre tous les postes connectés,
et historique complet des modifications.

## Stack technique

| Couche         | Techno                                   |
|----------------|-------------------------------------------|
| Backend        | Node.js + Express                         |
| Base de données| SQLite (via `better-sqlite3`, fichier local, aucun serveur à installer) |
| Auth           | JWT (`jsonwebtoken`) + mots de passe hashés (`bcryptjs`) |
| Temps réel     | Socket.io                                  |
| Frontend       | HTML/CSS/JS natif (aucun framework, connecté à l'API) |

Aucun service externe requis : tout tourne en local avec `node`.

## Installation

Prérequis : **Node.js 18 ou plus récent**.

```bash
# 1. Dézippez le projet puis placez-vous dedans
cd gangapp

# 2. Installez les dépendances
npm install

# 3. Créez votre fichier de configuration
cp .env.example .env
# puis ouvrez .env et changez au minimum JWT_SECRET et ADMIN_PASSWORD

# 4. Lancez le serveur
npm start
```

Au premier démarrage, la base SQLite est créée automatiquement (`./data/gangapp.db`)
avec son schéma, et un compte **admin** est créé à partir des identifiants définis
dans `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

Ouvrez ensuite **http://localhost:3000** dans votre navigateur, connectez-vous avec
ce compte admin, et commencez à créer vos gangs.

> Pour le développement avec rechargement automatique : `npm run dev`
> (utilise `node --watch`, inclus nativement depuis Node 18).

## Rôles utilisateurs

| Rôle     | Voir les gangs | Créer/modifier/supprimer gangs, catégories, items | Gérer les utilisateurs | Voir l'audit log |
|----------|:---:|:---:|:---:|:---:|
| `admin`  | ✅ | ✅ | ✅ | ✅ |
| `staff`  | ✅ | ✅ | ❌ | ✅ |
| `viewer` | ✅ | ❌ (lecture seule) | ❌ | ❌ |

Seul un `admin` peut créer de nouveaux comptes (bouton engrenage-utilisateurs dans la
barre latérale de l'app). Il n'y a pas d'auto-inscription : c'est volontaire, pour un
outil interne de serveur RP où l'accès doit rester contrôlé.

## Structure des données

```
Gang
 ├─ id, name, color, created_by, created_at, updated_at
 └─ Categories[]
     ├─ id, name
     └─ Items[]
         ├─ id, name, price, description
```

Stocké en SQLite avec suppression en cascade : supprimer un gang supprime ses
catégories et leurs items ; supprimer une catégorie supprime ses items.

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
| PUT | `/api/gangs/:id` | admin, staff | Modifier `{ name?, color? }` |
| DELETE | `/api/gangs/:id` | admin | Supprimer (cascade) |

### Catégories
| Méthode | Route | Rôle requis |
|---|---|---|
| POST | `/api/gangs/:gangId/categories` | admin, staff |
| PUT | `/api/gangs/:gangId/categories/:catId` | admin, staff |
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
| GET | `/api/search?q=terme` | connecté | Recherche server-side sur nom/description des items, tous gangs confondus |
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

- **Changez `JWT_SECRET`** dans `.env` : la valeur par défaut n'est pas sûre.
- **Changez `ADMIN_PASSWORD`** avant le premier démarrage, ou changez le mot de passe
  du compte admin juste après (via la modale utilisateurs, ou directement en base).
- Le fichier `.env` ne doit jamais être commité dans un dépôt Git public.
- Pour une exposition sur Internet (pas seulement en LAN/localhost), placez
  l'application derrière HTTPS (reverse proxy nginx/Caddy, ou un service comme
  Render/Railway qui gère le TLS automatiquement).
- Les mots de passe sont hashés avec bcrypt (jamais stockés en clair).
- Le token JWT est stocké côté client en `sessionStorage` (effacé à la fermeture de
  l'onglet), pas en cookie, pour limiter les risques CSRF — c'est un choix simple
  adapté à un outil interne d'équipe RP.

## Arborescence du projet

```
gangapp/
├── package.json
├── .env.example
├── server/
│   ├── index.js              # point d'entrée: Express + Socket.io
│   ├── db/
│   │   ├── database.js       # connexion SQLite + schéma
│   │   ├── seed.js           # création du compte admin initial
│   │   └── auditLog.js       # utilitaire d'écriture de l'historique
│   ├── middleware/
│   │   └── auth.js           # vérification JWT + contrôle des rôles
│   └── routes/
│       ├── auth.js           # login, gestion des utilisateurs
│       ├── gangs.js          # CRUD gangs/catégories/items
│       └── misc.js           # recherche, export, audit log
└── public/                   # frontend statique servi par Express
    ├── index.html
    ├── css/style.css
    └── js/
        ├── api.js            # wrapper fetch() avec JWT
        └── app.js             # rendu, événements, Socket.io client
```

## Étendre le système

- **Nouvelle catégorie par défaut** : ajoutez-la dans le tableau des `preset-chip`
  dans `public/index.html`/`app.js` — ou laissez les utilisateurs staff en créer
  librement, c'est déjà supporté sans limite.
- **Devise/format de prix** : la fonction `fmtPrice()` dans `public/js/app.js`
  centralise l'affichage (`$` + séparateur de milliers français).
- **Champ supplémentaire sur un item** (ex: stock, image) : ajoutez la colonne dans
  `server/db/database.js`, puis dans les routes POST/PUT de `server/routes/gangs.js`,
  puis dans le formulaire correspondant côté frontend.
- **Passer à MongoDB** : la seule couche à réécrire est `server/db/*.js` ; les routes
  (`server/routes/*.js`) manipulent des objets JS classiques et n'ont pas besoin de
  changer si vous gardez la même forme de données.
