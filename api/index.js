module.exports = (req, res) => {
  res.status(200).json({
    name: "iopool-mcp",
    status: "ok",
    endpoint: "/api/mcp",
    docs: "https://github.com/Xtrem65/iopool-mcp",
  });
};
