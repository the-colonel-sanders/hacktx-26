import "dotenv/config";
import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors({ origin: "http://localhost:5173" })); // your Vite/CRA origin
app.use(express.json({ limit: "2mb" }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-2.5-flash"; // check Google's docs for the current model name

// Keep only the fields Gemini needs (saves tokens, reduces noise)
const slim = (r) => ({
  name: r.title,
  type: r.type,
  address: r.address,
  rating: r.rating,
  reviews: r.reviews,
  phone: r.phone,
  website: r.website,
  hours: r.hours,
  coordinates: r.gps_coordinates,
});

// 1) SerpAPI search
app.get("/api/search", async (req, res) => {
  try {
    const params = new URLSearchParams({
      engine: "google_maps",
      type: "search",
      q: req.query.q,
      api_key: process.env.SERPAPI_KEY,
    });
    const r = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!r.ok) throw new Error(`SerpAPI error ${r.status}`);
    const data = await r.json();
    res.json({ results: (data.local_results || []).map(slim) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2) Gemini analysis
app.post("/api/analyze", async (req, res) => {
  try {
    const { query, results } = req.body;

    const prompt = `
You are an urban/real-estate analyst. Analyze the building search results below
for the query: "${query}".

Write a detailed plain-text report with these sections:
1. EXECUTIVE SUMMARY
2. OVERVIEW OF BUILDINGS FOUND (types, count, geographic spread)
3. NOTABLE BUILDINGS (highlights and why)
4. RATINGS & REVIEW PATTERNS
5. DATA GAPS / QUALITY ISSUES (missing fields, inconsistencies)
6. RECOMMENDATIONS & NEXT STEPS

Use only the data provided. If something isn't in the data, say so rather than guessing.
No markdown symbols; use plain text headings and dashes.

DATA:
${JSON.stringify(results, null, 2)}
`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { temperature: 0.3 },
    });

    res.json({ report: response.text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log("API on http://localhost:3001"));