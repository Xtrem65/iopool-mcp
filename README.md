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

L'authentification se fait par en-tête HTTP.

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

**Client générique** (`mcp.json`) :

```json
{
  "mcpServers": {
    "iopool": {
      "type": "http",
      "url": "https://iopool-mcp.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer VOTRE_CLE_API_IOPOOL"
      }
    }
  }
}
```

### Vérifier en ligne de commande

```bash
# Liste des outils (aucune clé nécessaire)
curl -s https://iopool-mcp.vercel.app/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Appel réel avec votre clé
curl -s https://iopool-mcp.vercel.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $IOPOOL_API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_pools","arguments":{}}}'
```

## Confidentialité

Aucune clé n'est stockée côté serveur : elle est lue dans l'en-tête de la
requête et transmise directement à l'API iopool le temps de l'appel. Le
serveur est sans état — pas de base de données, pas de session, pas de log
de clé.

Chaque utilisateur utilise donc **sa propre clé** : un déploiement partagé
ne donne accès à aucune piscine tant que l'appelant ne fournit pas la sienne.

## Déploiement

Fonctions serverless Node.js sur Vercel, **zéro dépendance** (`fetch` natif,
Node >= 18). Il suffit de connecter ce dépôt à un projet Vercel : chaque push
sur la branche de production redéploie automatiquement.

Aucune variable d'environnement n'est nécessaire.

| Route | Rôle |
|---|---|
| `GET /` | Endpoint de santé |
| `POST /api/mcp` | Endpoint MCP (JSON-RPC) |

## Licence

MIT
