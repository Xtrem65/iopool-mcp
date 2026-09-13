// Serveur d'autorisation OAuth 2.1 pour le connecteur MCP iopool.
//
// iopool ne propose pas d'OAuth, seulement une clé API statique. Ce module
// joue donc le rôle de serveur d'autorisation : l'utilisateur colle sa clé
// iopool une fois sur une page hébergée ici, et reçoit en échange un jeton
// qui contient cette clé sous forme chiffrée (voir lib/token.js).
//
// Rien n'est stocké : ni la clé, ni le jeton, ni le client enregistré.

const crypto = require("crypto");
const { seal, unseal, isConfigured } = require("../lib/token");

const IOPOOL_BASE_URL = "https://api.iopool.com/v1";
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

// Empêche la redirection ouverte : on n'accepte que les callbacks de Claude
// et les boucles locales utilisées par les clients en ligne de commande.
function isAllowedRedirect(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") {
    return url.hostname === "claude.ai" || url.hostname.endsWith(".claude.ai");
  }
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  return false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function iopoolKeyIsValid(apiKey) {
  try {
    const resp = await fetch(`${IOPOOL_BASE_URL}/pools/`, {
      headers: { "x-api-key": apiKey },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function consentPage({ params, error }) {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge",
    "code_challenge_method", "response_type", "scope", "resource"]
    .filter((name) => params[name])
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params[name])}">`)
    .join("\n      ");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion iopool</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#16181d;
          --muted:#5c6370; --line:#dfe2e8; --accent:#0b7285; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#181b21; --fg:#e8eaee; --muted:#9aa2b1;
            --line:#2a2f38; --accent:#3bc9db; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center;
         justify-content:center; padding:24px; background:var(--bg);
         color:var(--fg); font:16px/1.5 system-ui,-apple-system,sans-serif; }
  .card { width:100%; max-width:420px; background:var(--card);
          border:1px solid var(--line); border-radius:14px; padding:28px; }
  h1 { margin:0 0 6px; font-size:20px; }
  p { margin:0 0 18px; color:var(--muted); font-size:14px; }
  label { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
  input[type=password] { width:100%; padding:12px; font-size:16px;
          border:1px solid var(--line); border-radius:9px; background:var(--bg);
          color:var(--fg); font-family:ui-monospace,monospace; }
  button { width:100%; margin-top:16px; padding:13px; font-size:16px;
           font-weight:600; border:0; border-radius:9px; background:var(--accent);
           color:#fff; cursor:pointer; }
  .hint { margin-top:18px; padding-top:16px; border-top:1px solid var(--line);
          font-size:13px; color:var(--muted); }
  .err { margin:0 0 16px; padding:11px 13px; border-radius:9px; font-size:14px;
         background:#fdecec; color:#9b1c1c; border:1px solid #f5c2c2; }
  @media (prefers-color-scheme: dark) {
    .err { background:#2c1618; color:#ffa8a8; border-color:#4a2225; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Connecter votre piscine iopool</h1>
    <p>Claude a besoin de votre clé API iopool pour lire les données de votre piscine.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
    <form method="post">
      ${hidden}
      <label for="api_key">Clé API iopool</label>
      <input type="password" id="api_key" name="api_key" required autofocus
             autocomplete="off" autocapitalize="off" spellcheck="false"
             placeholder="collez votre clé ici">
      <button type="submit">Autoriser</button>
    </form>
    <div class="hint">
      Votre clé se trouve dans l'application iopool :
      <strong>Plus &rsaquo; Réglages &rsaquo; Clé API</strong>.<br><br>
      Elle n'est pas enregistrée sur ce serveur : elle est chiffrée à
      l'intérieur du jeton remis à Claude, et déchiffrée uniquement le temps
      de chaque requête vers iopool.
    </div>
  </main>
</body>
</html>`;
}

function sendJson(res, status, payload) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(status).json(payload);
}

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || "";
  const base = baseUrl(req);

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 500, {
      error: "server_error",
      error_description:
        "TOKEN_SECRET n'est pas configuré sur ce déploiement. " +
        "Ajoutez une variable d'environnement TOKEN_SECRET d'au moins 32 caractères.",
    });
    return;
  }

  // --- Découverte : métadonnées de la ressource protégée (RFC 9728) ---
  if (action === "protected-resource") {
    sendJson(res, 200, {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: ["iopool:read"],
      bearer_methods_supported: ["header"],
    });
    return;
  }

  // --- Découverte : métadonnées du serveur d'autorisation (RFC 8414) ---
  if (action === "authorization-server") {
    sendJson(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["iopool:read"],
    });
    return;
  }

  // --- Enregistrement dynamique de client (RFC 7591) ---
  // Le client est public et protégé par PKCE : on accepte tout le monde et on
  // ne stocke rien. L'identifiant renvoyé est purement informatif.
  if (action === "register") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "invalid_request" });
      return;
    }
    const body = req.body || {};
    sendJson(res, 201, {
      client_id: `iopool-${crypto.randomBytes(12).toString("hex")}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: body.client_name || "MCP client",
    });
    return;
  }

  // --- Autorisation : la page où l'utilisateur colle sa clé iopool ---
  if (action === "authorize") {
    const params = req.method === "POST"
      ? { ...(req.query || {}), ...(req.body || {}) }
      : { ...(req.query || {}) };
    delete params.action;

    const redirectUri = params.redirect_uri;
    if (!redirectUri || !isAllowedRedirect(redirectUri)) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "redirect_uri absent ou non autorisé.",
      });
      return;
    }
    if (params.code_challenge_method !== "S256" || !params.code_challenge) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "PKCE avec code_challenge_method=S256 est obligatoire.",
      });
      return;
    }

    const html = (error) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(error ? 400 : 200).send(consentPage({ params, error }));
    };

    if (req.method === "GET") {
      html(null);
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "invalid_request" });
      return;
    }

    const apiKey = (params.api_key || "").trim();
    if (!apiKey) {
      html("Veuillez saisir votre clé API iopool.");
      return;
    }
    if (!(await iopoolKeyIsValid(apiKey))) {
      html("Cette clé a été refusée par iopool. Vérifiez-la dans l'application (Plus > Réglages > Clé API).");
      return;
    }

    const code = seal({
      t: "code",
      k: apiKey,
      cc: params.code_challenge,
      ru: redirectUri,
      exp: Date.now() + CODE_TTL_MS,
    });

    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    res.setHeader("Location", target.toString());
    res.status(302).end();
    return;
  }

  // --- Échange du code contre un jeton ---
  if (action === "token") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "invalid_request" });
      return;
    }
    const body = req.body || {};
    const grantType = body.grant_type;

    const issue = (apiKey, withRefresh) => {
      const payload = {
        access_token: seal({ t: "access", k: apiKey, exp: Date.now() + ACCESS_TOKEN_TTL_MS }),
        token_type: "Bearer",
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        scope: "iopool:read",
      };
      if (withRefresh) payload.refresh_token = seal({ t: "refresh", k: apiKey });
      sendJson(res, 200, payload);
    };

    if (grantType === "authorization_code") {
      const claims = unseal(body.code);
      if (!claims || claims.t !== "code") {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "Code d'autorisation invalide ou expiré.",
        });
        return;
      }
      if (body.redirect_uri && body.redirect_uri !== claims.ru) {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "redirect_uri ne correspond pas à la demande initiale.",
        });
        return;
      }
      const verifier = body.code_verifier || "";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      if (!verifier || challenge !== claims.cc) {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "Vérification PKCE échouée.",
        });
        return;
      }
      issue(claims.k, true);
      return;
    }

    if (grantType === "refresh_token") {
      const claims = unseal(body.refresh_token);
      if (!claims || claims.t !== "refresh") {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "Jeton de rafraîchissement invalide.",
        });
        return;
      }
      issue(claims.k, true);
      return;
    }

    sendJson(res, 400, {
      error: "unsupported_grant_type",
      error_description: "Utilisez authorization_code ou refresh_token.",
    });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
};
