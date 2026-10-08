const express = require("express");
const { getPhone, searchPhones } = require("./src/mobiledokan");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "Rakib Phone API",
    version: "1.0.0",
    endpoints: {
      phone: "/api/phone?model=Redmi%2010C",
      search: "/api/search?q=Redmi%2010C",
      health: "/health"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok", time: new Date().toISOString() });
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ success: false, error: "q is required" });

    const data = await searchPhones(q);
    res.json({
      success: true,
      query: q,
      count: data.length,
      results: data
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Search failed"
    });
  }
});

app.get("/api/phone", async (req, res) => {
  try {
    const model = String(req.query.model || req.query.q || "").trim();
    if (!model) {
      return res.status(400).json({
        success: false,
        error: "model is required",
        example: "/api/phone?model=Redmi%2010C"
      });
    }

    const phone = await getPhone(model);

    if (!phone) {
      return res.status(404).json({
        success: false,
        error: "Phone not found",
        query: model
      });
    }

    res.json({
      success: true,
      query: model,
      data: phone
    });
  } catch (err) {
    console.error("[PHONE API]", err);
    res.status(500).json({
      success: false,
      error: err.message || "Unable to fetch phone information"
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Rakib Phone API running on port ${PORT}`);
});