import React, { useEffect, useState } from "react";
import { salvaAllenamento, leggiAllenamenti } from "./api";

export default function Allenamenti() {
  const [allenamenti, setAllenamenti] = useState([]);

  useEffect(() => {
    // Quando la pagina si carica → leggo i dati dal foglio
    leggiAllenamenti().then(setAllenamenti);
  }, []);

  const handleSave = async () => {
    await salvaAllenamento("Seduta Lunedì", "10x100 stile @1:30");
    const dataAggiornata = await leggiAllenamenti();
    setAllenamenti(dataAggiornata);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>📊 Allenamenti</h2>
      <button onClick={handleSave}>➕ Salva allenamento di test</button>
      <ul>
        {allenamenti.map((row, i) => (
          <li key={i}>{row.join(" - ")}</li>
        ))}
      </ul>
    </div>
  );
}
