const { isConfigured } = require("../lib/token");

module.exports = (req, res) => {
  res.status(200).json({
    name: "iopool-mcp",
    status: "ok",
    endpoint: "/api/mcp",
    // Indique si TOKEN_SECRET est en place, sans jamais révéler sa valeur.
    // OAuth ne fonctionne que lorsque cette variable est définie ET que le
    // déploiement en ligne est postérieur à son ajout.
    oauth: isConfigured() ? "configured" : "missing TOKEN_SECRET",
    docs: "https://github.com/Xtrem65/iopool-mcp",
  });
};
