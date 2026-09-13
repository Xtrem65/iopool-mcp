// Serveur MCP distant pour iopool — https://api.iopool.com
//
// Chaque utilisateur fournit sa propre clé API iopool, de trois façons
// (par ordre de préférence) :
//   1. en-tête "Authorization: Bearer <cle>"   — Claude Code, Claude Desktop
//   2. en-tête "x-iopool-api-key: <cle>"       — repli
//   3. dans l'URL : POST /api/mcp/<cle>        — pour les clients MCP qui ne
//      permettent pas d'en-tête personnalisé (connecteurs claude.ai)
//
// Aucune clé n'est stockée ni journalisée côté serveur : elle est simplement
// relayée vers l'API iopool le temps de l'appel.

const IOPOOL_BASE_URL = "https://api.iopool.com/v1";

// Versions du protocole MCP que ce serveur sait parler. On renvoie celle que
// le client demande quand on la connaît, sinon la plus ancienne (compatible
// avec tous les clients).
const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const FALLBACK_PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "list_pools",
    description:
      "Liste les piscines associées au compte iopool de l'utilisateur, avec leur identifiant.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_pool_data",
    description:
      "Récupère les données actuelles d'une piscine iopool : température, pH, ORP, mode, recommandation de filtration.",
    inputSchema: {
      type: "object",
      properties: {
        poolId: {
          type: "string",
          description:
            "Identifiant de la piscine, obtenu via l'outil list_pools.",
        },
      },
      required: ["poolId"],
    },
  },
];

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function extractApiKey(req) {
  const auth = req.headers["authorization"];
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const custom = req.headers["x-iopool-api-key"];
  if (custom) return firstValue(custom);

  // La réécriture vercel.json transforme /api/mcp/<cle> en /api/mcp?k=<cle>.
  const fromQuery = req.query && req.query.k;
  if (fromQuery) return firstValue(fromQuery);

  // Repli si la requête arrive sans passer par la réécriture.
  const match = /\/api\/mcp\/([^/?#]+)/.exec(req.url || "");
  if (match) return decodeURIComponent(match[1]);

  return null;
}

async function callIopool(path, apiKey) {
  const resp = await fetch(`${IOPOOL_BASE_URL}${path}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`iopool API ${resp.status}: ${text || resp.statusText}`);
  }
  return resp.json();
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-iopool-api-key, Mcp-Session-Id, MCP-Protocol-Version"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const body = req.body || {};
  const { id = null, method, params = {} } = body;

  // Notifications (pas d'id) : accusé de réception simple, pas de corps JSON-RPC attendu.
  if (id === null && method && method.startsWith("notifications/")) {
    res.status(202).end();
    return;
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : FALLBACK_PROTOCOL_VERSION;

        res.status(200).json(
          jsonRpcResult(id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "iopool-mcp", version: "1.1.0" },
          })
        );
        return;
      }

      case "tools/list": {
        res.status(200).json(jsonRpcResult(id, { tools: TOOLS }));
        return;
      }

      case "tools/call": {
        const apiKey = extractApiKey(req);
        if (!apiKey) {
          res.status(200).json(
            jsonRpcResult(id, {
              content: [
                {
                  type: "text",
                  text:
                    "Clé API iopool manquante. Configure l'en-tête " +
                    "'Authorization: Bearer <ta_cle_api>' dans ton client MCP, " +
                    "ou utilise l'URL /api/mcp/<ta_cle_api> si ton client ne " +
                    "permet pas d'en-tête personnalisé.",
                },
              ],
              isError: true,
            })
          );
          return;
        }

        const toolName = params.name;
        const args = params.arguments || {};

        let data;
        if (toolName === "list_pools") {
          data = await callIopool("/pools/", apiKey);
        } else if (toolName === "get_pool_data") {
          if (!args.poolId) {
            throw new Error("Le paramètre 'poolId' est requis.");
          }
          data = await callIopool(`/pool/${encodeURIComponent(args.poolId)}`, apiKey);
        } else {
          res.status(200).json(jsonRpcError(id, -32601, `Outil inconnu: ${toolName}`));
          return;
        }

        res.status(200).json(
          jsonRpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          })
        );
        return;
      }

      default:
        res.status(200).json(jsonRpcError(id, -32601, `Méthode inconnue: ${method}`));
        return;
    }
  } catch (err) {
    res.status(200).json(
      jsonRpcResult(id, {
        content: [{ type: "text", text: `Erreur: ${err.message}` }],
        isError: true,
      })
    );
  }
};
