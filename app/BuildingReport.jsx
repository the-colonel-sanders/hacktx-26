import { useState } from "react";

const API = "http://localhost:3001";

export default function BuildingReport() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [report, setReport] = useState("");
  const [status, setStatus] = useState("idle"); // idle | searching | analyzing | error
  const [error, setError] = useState("");

  const run = async () => {
    setError("");
    setReport("");
    try {
      setStatus("searching");
      const s = await fetch(`${API}/api/search?q=${encodeURIComponent(query)}`);
      const sData = await s.json();
      if (!s.ok) throw new Error(sData.error);
      setResults(sData.results);

      if (!sData.results.length) throw new Error("No results found.");

      setStatus("analyzing");
      const a = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results: sData.results }),
      });
      const aData = await a.json();
      if (!a.ok) throw new Error(aData.error);

      setReport(aData.report);
      setStatus("idle");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  };

  const downloadReport = () => {
    const header = `BUILDING ANALYSIS REPORT\nQuery: ${query}\nGenerated: ${new Date().toLocaleString()}\n${"=".repeat(50)}\n\n`;
    const blob = new Blob([header + report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `building-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const busy = status === "searching" || status === "analyzing";

  return (
    <div style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h2>Building Search Analyzer</h2>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. office buildings in downtown Austin"
        style={{ width: "70%", padding: 8 }}
      />
      <button onClick={run} disabled={busy || !query.trim()} style={{ marginLeft: 8, padding: 8 }}>
        {status === "searching" ? "Searching…" : status === "analyzing" ? "Analyzing…" : "Search & Analyze"}
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {results.length > 0 && <p>{results.length} buildings found.</p>}

      {report && (
        <>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 16 }}>{report}</pre>
          <button onClick={downloadReport}>Download report (.txt)</button>
        </>
      )}
    </div>
  );
}