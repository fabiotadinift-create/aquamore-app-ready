# Aquamore – Allenamento Builder

Stack: React + Vite + Tailwind + jsPDF.

## Avvio locale
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```
La cartella `dist/` è l'output che Vercel pubblica automaticamente.

## Deploy su GitHub Desktop → Vercel
1. **GitHub Desktop** → File → Add Local Repository → seleziona questa cartella → Commit → Publish repository.
2. **Vercel** → Add New → Project → Import da GitHub → seleziona la repo.
   - Framework: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. Click **Deploy** e usa l’URL pubblico generato.
