# ♞ Échecs

Jeu d'échecs complet dans le navigateur, sans build ni dépendance, déployé sur Vercel.

## Fonctionnalités

- **Toutes les règles** : roque, prise en passant, promotion, échec et mat, pat,
  triple répétition, règle des 50 coups, matériel insuffisant.
- **Trois modes** : à deux sur le même écran, contre l'ordinateur (3 niveaux),
  ou **en ligne avec un ami** via un simple lien.
- Clic ou glisser-déposer, clavier (flèches + Entrée), mobile et ordinateur.
- Historique en notation algébrique, annulation, export PGN, plateau retournable.
- Partie sauvegardée automatiquement ; **installable** et **jouable hors ligne** (PWA).

## Architecture

| Fichier | Rôle |
| --- | --- |
| `index.html` | Page unique |
| `css/style.css` | Styles (responsive, sombre) |
| `js/engine.js` | Moteur de règles (validé par des tests *perft*) |
| `js/ai.js` | IA alpha-bêta + quiescence, bornée dans le temps |
| `js/ai-worker.js` | Exécute l'IA dans un Web Worker (interface fluide) |
| `js/online.js` | Jeu en ligne pair-à-pair (WebRTC via PeerJS) |
| `js/app.js` | Interface et logique de partie |
| `sw.js` | Service worker (hors ligne) |
| `vercel.json` | En-têtes de sécurité (CSP…) et de cache |

Le jeu en ligne n'a besoin d'aucun serveur de jeu : le serveur public PeerJS ne sert
qu'à mettre les deux joueurs en relation, puis les coups passent directement de
navigateur à navigateur. Chaque coup reçu est revalidé par le moteur local.

## Développement

```bash
npm start   # serveur local sur http://localhost:3000
npm test    # tests du moteur et de l'IA
```

## Déploiement

Chaque push sur `main` est déployé par Vercel (preset « Other », aucune commande de build).
