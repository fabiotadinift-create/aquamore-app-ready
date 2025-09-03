const API_URL = https://script.google.com/macros/s/AKfycbwH0FYym56U7BlMkHkg3FdkDQdW_oi7Epa4ou1e7ZZSzy9_sglPkcQNQ38eCzKaf_33bQ/exec;

// 📌 Salva un nuovo allenamento nel Google Sheet
export async function salvaAllenamento(titolo, testo) {
  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titolo, testo }),
  });
}

// 📌 Leggi tutti gli allenamenti dal Google Sheet
export async function leggiAllenamenti() {
  const res = await fetch(API_URL);
  const data = await res.json();
  return data; // Array con tutte le righe del foglio
}
