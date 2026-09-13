// Jetons OAuth sans stockage.
//
// La clé API iopool de l'utilisateur est chiffrée (AES-256-GCM) à l'intérieur
// du jeton lui-même. Le serveur n'a donc aucune base de données : il déchiffre
// le jeton à chaque appel pour récupérer la clé, s'en sert, et l'oublie.
// Seul le détenteur de TOKEN_SECRET peut lire le contenu d'un jeton.

const crypto = require("crypto");

function encryptionKey() {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "TOKEN_SECRET est absent ou trop court (32 caractères minimum). " +
        "Ajoutez-le dans les variables d'environnement du projet."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

// Chiffre un objet en une chaîne transportable dans une URL ou un en-tête.
function seal(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

// Déchiffre et vérifie l'expiration. Renvoie null si le jeton est invalide,
// falsifié, chiffré avec un autre secret, ou expiré.
function unseal(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= 28) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      raw.subarray(0, 12)
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(json);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function isConfigured() {
  const secret = process.env.TOKEN_SECRET;
  return typeof secret === "string" && secret.length >= 32;
}

module.exports = { seal, unseal, isConfigured };
