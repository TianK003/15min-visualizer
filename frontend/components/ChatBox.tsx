"use client";

import { useState } from "react";
import * as h3 from "h3-js";

type Props = {
  onSelectH3: (h3id: string) => void;
  flyToCoord: (lng: number, lat: number, targetZoom?: number) => void;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatBox({ onSelectH3, flyToCoord }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Živijo! Opiši svojo življenjsko situacijo (npr. 'Sva mlada družina in delava v Ljubljani in Mariboru') in poiskal ti bom najboljše lokacije za bivanje!"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      // Build history from all previous messages, excluding filter summaries (🔍)
      const history = [...messages, { role: "user" as const, content: userMsg }]
        .filter(m => !m.content.startsWith("🔍"))
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "search", query: userMsg, history: history.slice(0, -1) })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setMessages(prev => [...prev, { role: "assistant", content: `Napaka: ${data.error || "Neznana napaka"}` }]);
        return;
      }

      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.reply_text_sl },
        ...(data.filter_summary
          ? [{ role: "assistant" as const, content: `🔍 ${data.filter_summary}` }]
          : []),
      ]);
      
      if (data.top_cells && data.top_cells.length > 0) {
        const bestCell = data.top_cells[0].h3;
        
        // Defensive H3 coordinate conversion
        try {
          const coords = h3.cellToLatLng(bestCell);
          if (coords && coords.length === 2) {
            const [lat, lng] = coords;
            setTimeout(() => {
              flyToCoord(lng, lat, 14);
              onSelectH3(bestCell);
            }, 500);
          }
        } catch (h3Err) {
          console.error("H3 conversion error:", h3Err);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Prišlo je do napake pri iskanju." }]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button 
        className="chat-toggle"
        onClick={() => setOpen(true)}
        aria-label="Odpri AI asistenta"
      >
        ✨ Najdi mi dom
      </button>
    );
  }

  return (
    <div className="chat-box">
      <div className="chat-header">
        <h3>✨ AI Asistent</h3>
        <button onClick={() => setOpen(false)} aria-label="Zapri">×</button>
      </div>
      
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {loading && <div className="chat-msg assistant">Razmišljam...</div>}
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input 
          type="text" 
          placeholder="Opiši, kaj iščeš..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Pošlji
        </button>
      </form>
    </div>
  );
}
