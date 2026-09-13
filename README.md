# iopool-mcp

Serveur MCP (Model Context Protocol) distant pour consulter les données de
votre piscine iopool (température, pH, ORP, mode, recommandation de
filtration) directement depuis un assistant compatible MCP (Claude, etc.).

## Pourquoi

L'API publique iopool ([documentation](https://help.iopool.com/fr/articles/5537423-api-publique-iopool))
n'a pas de connecteur MCP officiel. Ce projet en propose un, hébergé, sans
avoir besoin de faire tourner quoi que ce soit en local.

## Utilisation

Ajoutez ce serveur comme connecteur MCP distant dans votre client, avec :

- **URL** : `https://<votre-deploiement>.vercel.app/api/mcp`
- **En-tête d'authentification** : `Authorization: Bearer <votre_cle_api_iopool>`

Votre clé API iopool se récupère dans l'application mobile iopool :
**Plus > Réglages > Clé API**.

Aucune clé n'est stockée côté serveur : elle est transmise à chaque appel
directement à l'API iopool.

## Outils exposés

| Outil | Description |
|---|---|
| `list_pools` | Liste les piscines du compte et leurs identifiants |
| `get_pool_data` | Données actuelles d'une piscine (température, pH, ORP, mode, filtration) — nécessite `poolId` |

## Déploiement

Ce projet est prévu pour Vercel (fonctions serverless Node.js, zéro
dépendance). Il suffit de connecter le dépôt à un projet Vercel.

## Licence

MIT
