# iopool-mcp

Serveur MCP (Model Context Protocol) distant pour consulter les données de
votre piscine iopool (température, pH, ORP, mode, recommandation de
filtration) directement depuis un assistant compatible MCP (Claude, etc.).

## Pourquoi

L'API publique iopool ([documentation](https://help.iopool.com/fr/articles/5537423-api-publique-iopool))
n'a pas de connecteur MCP officiel. Ce projet en propose un, hébergé, sans
avoir besoin de faire tourner quoi que ce soit en local.

## Outils exposés

| Outil | Description |
|---|---|
| `list_pools` | Liste les piscines du compte et leurs identifiants |
| `get_pool_data` | Données actuelles d'une piscine (température, pH, ORP, mode, filtration) — nécessite `poolId` |

## Récupérer sa clé API iopool

Dans l'application mobile iopool : **Plus > Réglages > Clé API**.

## Configuration du connecteur MCP

Deux méthodes d'authentification. Choisissez selon votre client.

### Méthode A — OAuth (claude.ai, web et mobile)

Le formulaire « Ajouter un connecteur personnalisé » de claude.ai ne propose
ni champ d'en-tête ni jeton statique : OAuth est la seule option. Ce serveur
embarque donc son propre serveur d'autorisation.

Dans **Réglages > Connecteurs > Ajouter un connecteur personnalisé** :

| Champ | Valeur |
|---|---|
| Nom | `iopool` |
| URL du serveur MCP | `https://iopool-mcp.vercel.app/api/mcp` |
| Connexion requise | **activé** |
| ID / Secret client OAuth | laisser vide |

Laissez les champs client vides : le serveur accepte l'enregistrement
dynamique (RFC 7591). À la connexion, une page s'ouvre et vous demande votre
clé API iopool ; elle est vérifiée auprès d'iopool, puis chiffrée à
l'intérieur du jeton remis à Claude. Vous ne la ressaisissez plus ensuite.

### Méthode B — clé directe (Claude Code, Claude Desktop, curl)

- **URL** : `https://iopool-mcp.vercel.app/api/mcp`
- **En-tête** : `Authorization: Bearer <votre_cle_api_iopool>`
- **Repli accepté** : `x-iopool-api-key: <votre_cle_api_iopool>`

**Claude Code** :

```bash
claude mcp add --transport http iopool https://iopool-mcp.vercel.app/api/mcp \
  --header "Authorization: Bearer VOTRE_CLE_API_IOPOOL"
```

**Claude Desktop** (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "iopool": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://iopool-mcp.vercel.app/api/mcp",
        "--header", "Authorization:Bearer VOTRE_CLE_API_IOPOOL"
      ]
    }
  }
}
```

### Vérifier en ligne de commande

```bash
curl -s https://iopool-mcp.vercel.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $IOPOOL_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_pools","arguments":{}}}'
```

Une requête sans en-tête `Authorization` reçoit un `401` accompagné de
`WWW-Authenticate`, ce qui déclenche le parcours OAuth côté client.

## Déployer votre propre instance

Ce dépôt est réutilisable tel quel. Connectez-le à un projet Vercel, puis :

1. Ajoutez une variable d'environnement **`TOKEN_SECRET`** (32 caractères
   minimum, aléatoire). Elle sert à chiffrer les jetons OAuth.
   Générez-la avec `openssl rand -base64 32`.
2. Désactivez **Vercel Authentication** dans *Settings > Deployment
   Protection*, sinon les clients MCP se heurtent à un écran de connexion.

Sans `TOKEN_SECRET`, les endpoints OAuth renvoient une erreur explicite et
seule l'authentification par en-tête fonctionne.

### Endpoints OAuth exposés

| Route | Rôle |
|---|---|
| `/.well-known/oauth-protected-resource` | Métadonnées de ressource protégée (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Métadonnées du serveur d'autorisation (RFC 8414) |
| `/oauth/register` | Enregistrement dynamique de client (RFC 7591) |
| `/oauth/authorize` | Page de saisie de la clé iopool |
| `/oauth/token` | Échange du code et rafraîchissement |

PKCE `S256` est obligatoire, et les `redirect_uri` sont restreints aux
domaines `claude.ai` et aux boucles locales.

## Confidentialité

Aucune clé n'est stockée côté serveur : il n'y a ni base de données, ni
session, ni journalisation de clé.

En authentification directe, la clé est lue dans l'en-tête et transmise à
l'API iopool le temps de l'appel. En OAuth, elle est chiffrée en AES-256-GCM
à l'intérieur du jeton remis au client : le serveur la déchiffre à chaque
requête, s'en sert, et l'oublie. Un jeton volé est inutilisable sans
`TOKEN_SECRET`, et changer cette variable révoque tous les jetons émis.

Chaque utilisateur utilise donc **sa propre clé** : un déploiement partagé
ne donne accès à aucune piscine tant que l'appelant ne fournit pas la sienne.

## Déploiement

Fonctions serverless Node.js sur Vercel, **zéro dépendance** (`fetch` et
`crypto` natifs, Node >= 18). Chaque push sur la branche de production
redéploie automatiquement.

| Route | Rôle |
|---|---|
| `GET /` | Endpoint de santé |
| `POST /api/mcp` | Endpoint MCP (JSON-RPC) |

Les routes OAuth sont listées plus haut.

## Licence

MIT
