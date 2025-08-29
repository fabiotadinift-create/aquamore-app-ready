import React, { useMemo, useState, useEffect } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Aquamore – Allenamento Builder (Planner + Autosave)
 * - Planner settimanale con volumi per gruppo
 * - Salvataggio automatico per giorno (localStorage)
 * - Ora predefinita sempre 18:00
 * - Elimina seduta del giorno
 * - Fallback: se non usi [MAIN], il main è uguale per tutti (il testo generale)
 */

// ============ Util ============
const toSeconds = (s: string) => {
  if (!s) return 0;
  const parts = s.split(":").map((x) => parseInt(x, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
};
const formatHMM = (secs: number) => {
  if (!secs || secs <= 0) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};
const clean = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const pad2 = (n: number) => String(n).padStart(2, "0");
const sixPMLocal = (d: Date) => {
  const x = new Date(d);
  x.setHours(18, 0, 0, 0);
  return x;
};
const toLocalDatetimeInput = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // lunedì
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
};
const weekDays = (d0: Date) =>
  Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d0);
    x.setDate(x.getDate() + i);
    return x;
  });

// ============ Riconoscimenti ============
const strokeKeywords = {
  free: ["stile", "sl", "freestyle", "free"],
  fly: ["farfalla", "fa", "delfino", "fly"],
  back: ["dorso", "do", "back"],
  breast: ["rana", "ra", "breast"],
  mix: ["misti", "im", "mx", "mix"],
};
const typeKeywords = {
  pull: ["pull", "boa", "buoy", "braccia"],
  kick: ["gambe", "kick", "pinne gambe"],
  tech: ["tec", "tecnica", "drill", "skills", "didattica"],
  swim: ["swim", "stile", "sl", "nuoto"],
};
const equipmentKeywords = {
  Buoys: ["pull", "boa", "buoy"],
  Paddles: ["palette", "paddles", "palette"],
  Fins: ["pinne", "fins"],
  Snorkel: ["snorkel"],
  Elastico: ["elastico"],
  Paracadute: ["paracadute", "parachute"],
};
const zoneOrder = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const groupList = ["Velocisti", "Mezzofondo", "Salvamento"] as const;

function detectStroke(txt: string) {
  const t = clean(txt);
  for (const [key, arr] of Object.entries(strokeKeywords))
    if (arr.some((k) => t.includes(k))) return key;
  if (t.includes("mx/")) return "mix";
  return null;
}
function detectType(txt: string) {
  const t = clean(txt);
  for (const [key, arr] of Object.entries(typeKeywords))
    if (arr.some((k) => t.includes(k))) return key;
  return "swim";
}
function detectZone(txt: string) {
  const zones = ["A1", "A2", "B1", "B2", "C1", "C2"];
  for (const z of zones)
    if (new RegExp(`(^|\\s)${z}(?=$|\\s|[.,;])`, "i").test(txt)) return z;
  const t = clean(txt);
  if (/(sciolt|rec|recupero)/.test(t)) return "A1";
  if (/(progressiv|medio)/.test(t)) return "A2";
  return null;
}
function detectEquipment(txt: string) {
  const t = clean(txt);
  const found: Record<string, true> = {};
  for (const [eq, arr] of Object.entries(equipmentKeywords))
    if (arr.some((k) => t.includes(k))) found[eq] = true;
  return Object.keys(found);
}

// ============ Parser & aggregatori ============
type Parsed = {
  line: string;
  meters: number;
  reps: number;
  dist: number;
  stroke: string;
  type: string;
  zone: string | null;
  equip: string[];
  intervalSec: number;
};
function parseLine(raw: string): Parsed | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  const txt = clean(line);

  const atMatch = txt.match(/@\s*([0-9:]+)/);
  const intervalSec = atMatch ? toSeconds(atMatch[1]) : 0;

  const rxd = txt.match(/(\d+)\s*x\s*(\d+)/);
  let reps = 0;
  let dist = 0;
  if (rxd) {
    reps = parseInt(rxd[1], 10);
    dist = parseInt(rxd[2], 10);
  }
  if (!rxd) {
    const leadNum = txt.match(/^(\d{2,4})\b/);
    if (leadNum) {
      reps = 1;
      dist = parseInt(leadNum[1], 10);
    }
  }
  if (!reps || !dist) return null;

  const meters = reps * dist;
  const stroke = detectStroke(txt) || "free";
  const type = detectType(txt);
  const zone = detectZone(line);
  const equip = detectEquipment(line);

  return { line, meters, reps, dist, stroke, type, zone, equip, intervalSec };
}
function setDurationSec(p: Parsed, basePaceSec: number, restFactor: number) {
  if (p.intervalSec && p.reps) return p.intervalSec * p.reps;
  const swimTime = Math.round((p.meters / 100) * basePaceSec);
  return Math.round(swimTime * (1 + restFactor));
}
function aggregate(parsed: Parsed[], basePaceSec = 90, restFactor = 0.2) {
  const totals = {
    meters: 0,
    byStroke: { free: 0, mix: 0, fly: 0, back: 0, breast: 0 },
    byType: { swim: 0, pull: 0, kick: 0, tech: 0 },
    byEquip: { Buoys: 0, Paddles: 0, Fins: 0, Snorkel: 0, Elastico: 0, Paracadute: 0 },
    byZone: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
    durationSec: 0,
  };
  for (const p of parsed) {
    totals.meters += p.meters;
    // @ts-ignore
    if (totals.byStroke[p.stroke] !== undefined) totals.byStroke[p.stroke] += p.meters;
    // @ts-ignore
    if (totals.byType[p.type] !== undefined) totals.byType[p.type] += p.meters;
    for (const eq of p.equip)
      // @ts-ignore
      if (totals.byEquip[eq] !== undefined) totals.byEquip[eq] += p.meters;
    // @ts-ignore
    if (p.zone && totals.byZone[p.zone] !== undefined) totals.byZone[p.zone] += p.meters;
    totals.durationSec += setDurationSec(p, basePaceSec, restFactor);
  }
  return totals;
}
const sumZones = (...objs: any[]) => {
  const z = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
  for (const o of objs) {
    if (!o) continue;
    const src = o.byZone || o;
    for (const k of Object.keys(z)) (z as any)[k] += Number(src[k] || 0);
  }
  return z;
};
const parseText = (txt: string) =>
  String(txt || "").split(/\n+/).map(parseLine).filter(Boolean) as Parsed[];
const aggText = (txt: string, pace100: number, restPct: number) =>
  aggregate(parseText(txt), pace100, restPct / 100);

function splitMain(txt: string) {
  const lines = String(txt || "").split("\n");
  const idx = lines.findIndex((l) => /^\s*\[MAIN\]\s*$/i.test(l));
  if (idx < 0) return { preText: txt || "", postText: "", hasMain: false };
  const preText = lines.slice(0, idx).join("\n");
  const postText = lines.slice(idx + 1).join("\n");
  return { preText, postText, hasMain: true };
}

// ============ Storage ============
const STORAGE_KEY = "aqm_sessions_v1";
const loadAll = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};
const saveFor = (key: string, data: any) => {
  const all = loadAll();
  all[key] = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};
const removeFor = (key: string) => {
  const all = loadAll();
  delete all[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};

// ============ UI Bits ============
const Tag = ({ label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 rounded-2xl text-sm border transition ${
      active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
    }`}
  >
    {label}
  </button>
);
const AquamoreLogo = () => (
  <div className="flex items-center gap-2 select-none">
    <svg viewBox="0 0 64 64" className="w-7 h-7">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="1" y2="0">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
    {/* goccia semplice */}
      <path d="M32 6 C20 20 12 30 12 40 a20 20 0 0 0 40 0 C52 30 44 20 32 6z" fill="url(#g)" />
      <circle cx="32" cy="42" r="6" fill="white" opacity="0.9" />
    </svg>
    <span className="font-bold text-lg tracking-tight">Aquamore</span>
  </div>
);

// ============ Scenario (riusabile anche nel planner) ============
function computeScenarioForData(data: any) {
  const text = data?.text || "";
  const pace100 = data?.pace100 ?? 90;
  const restPct = data?.restPct ?? 20;
  const ms = data?.mainSets || {};
  const hasMainMarker = /\n?\[MAIN\]\n?/i.test(text);

  // Fallback: niente [MAIN] → stesso testo per tutti
  if (!hasMainMarker) {
    const agg = aggText(text, pace100, restPct);
    const perGroup: any = {};
    for (const g of groupList)
      perGroup[g] = {
        pre: 0,
        main: agg.meters,
        post: 0,
        total: agg.meters,
        durationSec: agg.durationSec,
        zones: agg.byZone,
      };
    return {
      preAgg: { meters: 0, byZone: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 } },
      postAgg: { meters: 0, byZone: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 } },
      perGroup,
    };
  }

  // Con [MAIN] → pre/post comuni + main per gruppo
  const { preText, postText } = splitMain(text);
  const preAgg = aggText(preText, pace100, restPct);
  const postAgg = aggText(postText, pace100, restPct);
  const perGroup: any = {};
  for (const g of groupList) {
    const mainAgg = aggText(ms[g] || "", pace100, restPct);
    const meters = preAgg.meters + mainAgg.meters + postAgg.meters;
    const durationSec = preAgg.durationSec + mainAgg.durationSec + postAgg.durationSec;
    perGroup[g] = {
      pre: preAgg.meters,
      main: mainAgg.meters,
      post: postAgg.meters,
      total: meters,
      durationSec,
      zones: sumZones(preAgg.byZone, mainAgg.byZone, postAgg.byZone),
    };
  }
  return { preAgg, postAgg, perGroup };
}

// ============ App ============
export default function App() {
  // Planner
  const [currentDate, setCurrentDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));

  // Editor
  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [groups, setGroups] = useState<string[]>(["Jun", "Cad", "Sen"]);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [pace100, setPace100] = useState(90);
  const [restPct, setRestPct] = useState(20);
  const [rpe, setRpe] = useState(5);
  const [mainSets, setMainSets] = useState<any>({
    Velocisti: "",
    Mezzofondo: "",
    Salvamento: "",
  });

  // Carica il giorno
  const loadDay = (d: Date) => {
    const key = dateKey(d);
    const data = loadAll()[key];
    if (data) {
      setTitle(data.title || "");
      setDatetime(data.datetime || toLocalDatetimeInput(sixPMLocal(d)));
      setGroups(Array.isArray(data.groups) ? data.groups : ["Jun", "Cad", "Sen"]);
      setTags(Array.isArray(data.tags) ? data.tags : []);
      setText(data.text || "");
      setPace100(data.pace100 ?? 90);
      setRestPct(data.restPct ?? 20);
      setRpe(data.rpe ?? 5);
      setMainSets({
        Velocisti: data.mainSets?.Velocisti || "",
        Mezzofondo: data.mainSets?.Mezzofondo || "",
        Salvamento: data.mainSets?.Salvamento || "",
      });
    } else {
      // default vuoto (ora 18:00)
      setTitle("");
      setDatetime(toLocalDatetimeInput(sixPMLocal(d)));
      setGroups(["Jun", "Cad", "Sen"]);
      setTags([]);
      setText("");
      setPace100(90);
      setRestPct(20);
      setRpe(5);
      setMainSets({ Velocisti: "", Mezzofondo: "", Salvamento: "" });
    }
  };
  useEffect(() => {
    loadDay(currentDate);
  }, [currentDate]);

  // Autosave debounce
  useEffect(() => {
    const t = setTimeout(() => {
      const key = dateKey(currentDate);
      saveFor(key, { title, datetime, groups, tags, text, pace100, restPct, rpe, mainSets });
    }, 400);
    return () => clearTimeout(t);
  }, [title, datetime, groups, tags, text, pace100, restPct, rpe, mainSets, currentDate]);

  // Navigazione
  const prevWeek = () =>
    setWeekStart((w) => {
      const x = new Date(w);
      x.setDate(x.getDate() - 7);
      return x;
    });
  const nextWeek = () =>
    setWeekStart((w) => {
      const x = new Date(w);
      x.setDate(x.getDate() + 7);
      return x;
    });
  const goToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setWeekStart(startOfWeek(today));
  };

  // Dati calcolati per il giorno corrente
  const parsed = useMemo(() => parseText(text), [text]);
  const totals = useMemo(
    () => aggregate(parsed, pace100, restPct / 100),
    [parsed, pace100, restPct]
  );
  const sessionLoad = Math.round((totals.durationSec / 60) * rpe);
  const scenario = useMemo(
    () => computeScenarioForData({ text, pace100, restPct, mainSets }),
    [text, pace100, restPct, mainSets]
  );

  const toggleList = (val: string, list: string[], setter: Function) =>
    setter(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);

  const exampleMF = () => {
    setTitle("Medio A2 – Pull focus");
    setTags(["Mezzofondo"]);
    setText(`600 sciolti
6x50 tecnica
4x50 progressivi

[MAIN]

200 sciolti`);
  };
  const exampleSPR = () => {
    setTitle("VO2 & Potenza – 50s");
    setTags(["Velocisti"]);
    setText(`400 sciolti
4x50 subacquee @1:10

[MAIN]

200 sciolti`);
  };

  const copyText = async () => {
    const header = `${title || "(senza titolo)"} • ${groups.join(" ")} ${tags.length ? "#" + tags.join(" #") : ""}`;
    const body = text.trim();
    try {
      await navigator.clipboard.writeText(`${header}\n\n${body}`);
      alert("Copiato negli appunti");
    } catch {
      alert("Impossibile copiare: consenti l'accesso agli appunti");
    }
  };

  // TSV per Fogli (3 righe = 3 gruppi)
  const formatDateForSheets = (s: string) => {
    const d = s ? new Date(s) : sixPMLocal(currentDate);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const rowsForSheets = () => {
    const dt = formatDateForSheets(datetime);
    const tagStr = (Array.isArray(tags) ? tags : []).join(" ");
    const allGroups = (Array.isArray(groups) ? groups : []).join(" ");
    return groupList.map((g) => {
      const sc = (scenario.perGroup || ({} as any))[g] || {};
      const z = sc.zones || {};
      const main = (mainSets || ({} as any))[g] || "";
      return [
        dt, title, tagStr, allGroups, g, main,
        sc.pre || 0, sc.main || 0, sc.post || 0, sc.total || 0,
        sc.durationSec || 0, sessionLoad,
        z.A1 || 0, z.A2 || 0, z.B1 || 0, z.B2 || 0, z.C1 || 0, z.C2 || 0,
      ];
    });
  };
  const copyTSVForSheets = async () => {
    const sanitize = (v: any) => String(v ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
    const tsv = rowsForSheets().map((r) => r.map(sanitize).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      alert('Copiato ✅ Vai su Fogli → scheda "Allenamenti" → INCOLLA.');
    } catch {
      const name = `${(title || "allenamento").replace(/[^a-z0-9]+/gi, "_")}_rows.tsv`;
      const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Export PDF
  const exportPDF = () => {
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();

      doc.setFontSize(16);
      doc.text("Aquamore – Allenamento", 40, 40);
      doc.setFontSize(12);
      doc.text(`${title || "(senza titolo)"}`, 40, 60);
      if (datetime) doc.text(`Data/Ora: ${new Date(datetime).toLocaleString()}`, 40, 78);
      doc.text(`Gruppi: ${groups.join(" ")}`, 40, 96);
      if (tags.length) doc.text(`Tag: ${tags.join(", ")}`, 40, 114);

      const bodyRows =
        parsed.length > 0
          ? parsed.map((p) => [
              p.line,
              p.meters,
              p.stroke,
              p.type,
              p.zone || "",
              p.intervalSec ? formatHMM(p.intervalSec) : "",
              formatHMM(setDurationSec(p as any, pace100, restPct / 100)),
            ])
          : [["(nessuna riga valida)", "-", "-", "-", "-", "-", "-"]];

      // @ts-ignore
      autoTable(doc, {
        startY: 130,
        head: [["Set", "m", "Stile", "Tipo", "Zona", "@", "Tempo set"]],
        body: bodyRows,
        styles: { fontSize: 9 },
        columnStyles: { 0: { cellWidth: pageW - 260 } },
        theme: "striped",
      });

      // @ts-ignore
      const y1 = (doc.lastAutoTable?.finalY || 130) + 16;
      // @ts-ignore
      autoTable(doc, {
        startY: y1,
        head: [["Totale metri", "Durata", "Session Load (Foster)"]],
        body: [[totals.meters.toLocaleString(), formatHMM(totals.durationSec), String(sessionLoad)]],
        styles: { fontSize: 10 },
        theme: "plain",
      });

      // @ts-ignore
      const y2 = (doc.lastAutoTable?.finalY || y1) + 24;
      // @ts-ignore
      autoTable(doc, {
        startY: y2,
        head: [["Gruppo", "Pre", "Main", "Post", "Totale"]],
        body: (["Velocisti","Mezzofondo","Salvamento"] as const).map((g) => [
          g,
          (scenario.perGroup[g]?.pre || 0).toLocaleString(),
          (scenario.perGroup[g]?.main || 0).toLocaleString(),
          (scenario.perGroup[g]?.post || 0).toLocaleString(),
          (scenario.perGroup[g]?.total || 0).toLocaleString(),
        ]),
        styles: { fontSize: 9 },
        theme: "grid",
      });

      const filename = `${(title || "allenamento").replace(/[^a-z0-9]+/gi, "_")}_allenamento.pdf`;
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => {
        try { window.location.href = url; }
        finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
      }, 0);
    } catch (err) {
      console.error("Errore Export PDF", err);
      alert("Errore nell'export PDF");
    }
  };

  // Inserisci un main
  const insertMain = (group: string) => {
    const block = (mainSets[group] || "").trim();
    if (!block) return;
    const lines = String(text || "").split("\n");
    const idx = lines.findIndex((l) => /^\s*\[MAIN\]\s*$/i.test(l));
    if (idx >= 0) lines[idx] = block;
    else lines.push("", block);
    setText(lines.join("\n"));
  };

  const deleteSession = () => {
    if (!confirm("Eliminare la seduta del giorno?")) return;
    removeFor(dateKey(currentDate));
    loadDay(currentDate);
  };

  // ============ UI ============
  const week = weekDays(weekStart);
  const weekdayLabel = (d: Date) =>
    ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"][(d.getDay() + 6) % 7];

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-800">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Planner header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 rounded-full border" onClick={prevWeek}>
              ◀ Settimana
            </button>
            <button className="px-3 py-1 rounded-full border" onClick={goToday}>
              Oggi
            </button>
            <button className="px-3 py-1 rounded-full border" onClick={nextWeek}>
              Settimana ▶
            </button>
          </div>
          <AquamoreLogo />
          <div />
        </div>

        {/* Week grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 mb-6">
          {week.map((d) => {
            const key = dateKey(d);
            const data = loadAll()[key];
            const scen = data ? computeScenarioForData(data) : null;
            const isSel = dateKey(currentDate) === key;
            return (
              <div
                key={key}
                onClick={() => setCurrentDate(d)}
                className={`cursor-pointer border rounded-xl p-2 bg-white hover:bg-gray-50 ${isSel ? "ring-2 ring-blue-500" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    {weekdayLabel(d)} {pad2(d.getDate())}/{pad2(d.getMonth() + 1)}
                  </div>
                  {isSel && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100">
                      sel.
                    </span>
                  )}
                </div>
                <div
                  className="text-xs text-gray-600 mt-1 truncate"
                  title={data?.title || "(vuoto)"}
                >
                  {data?.title || "(vuoto)"}
                </div>
                {/* volumi a destra, uno sotto l'altro */}
                <div className="mt-1 flex justify-end">
                  <div className="text-[11px] text-right leading-tight">
                    {(["Velocisti","Mezzofondo","Salvamento"] as const).map((g) => (
                      <div key={g}>
                        {g.slice(0, 3)}:{" "}
                        <span className="font-semibold">
                          {scen ? (scen.perGroup[g]?.total || 0).toLocaleString() : 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Editor header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="px-3 py-2 rounded-xl border w-64"
              placeholder="Titolo seduta"
            />
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              className="px-3 py-2 rounded-xl border"
            />
            <div className="flex gap-2">
              {["EsB", "EsA", "Rag", "Jun", "Cad", "Sen", "Master"].map((g) => (
                <Tag
                  key={g}
                  label={g}
                  active={groups.includes(g)}
                  onClick={() => toggleList(g, groups, setGroups)}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(["Velocisti","Mezzofondo","Salvamento"] as const).map((t) => (
              <Tag
                key={t}
                label={t}
                active={tags.includes(t)}
                onClick={() => toggleList(t, tags, setTags)}
              />
            ))}
            <button onClick={copyText} className="px-3 py-2 rounded-xl border">
              Copia
            </button>
            <button
              onClick={copyTSVForSheets}
              className="px-3 py-2 rounded-xl bg-blue-600 text-white"
            >
              Copia per Sheets
            </button>
            <button
              onClick={exportPDF}
              className="px-3 py-2 rounded-xl bg-black text-white shadow"
            >
              Export PDF
            </button>
            <button
              onClick={deleteSession}
              className="px-3 py-2 rounded-xl border text-red-600"
            >
              Elimina seduta
            </button>
          </div>
        </div>

        {/* Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Editor */}
          <div className="xl:col-span-2 bg-white rounded-2xl shadow p-3 sm:p-4">
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <div className="font-semibold">Editor seduta</div>
              <div className="flex gap-2 text-sm">
                <button className="px-3 py-1 rounded-full border" onClick={exampleMF}>
                  Esempio MF
                </button>
                <button className="px-3 py-1 rounded-full border" onClick={exampleSPR}>
                  Esempio Vel
                </button>
              </div>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-[420px] outline-none resize-y p-3 rounded-xl border focus:ring-2 focus:ring-blue-500/20 font-mono"
              placeholder={`Scrivi qui la seduta...
Suggerito: usa la riga [MAIN] se vuoi inserire Lavori Centrali diversi per gruppo.
Se NON usi [MAIN], il testo vale uguale per tutti i gruppi.`}
            />

            {/* main per gruppo */}
            <div className="mt-4">
              <div className="font-semibold mb-2">Lavoro centrale per gruppo</div>
              <div className="grid sm:grid-cols-3 gap-3">
                {Object.keys(mainSets).map((g) => (
                  <div key={g} className="border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{g}</div>
                      <button
                        className="px-2 py-1 text-xs rounded-full border"
                        onClick={() => insertMain(g)}
                      >
                        Inserisci
                      </button>
                    </div>
                    <textarea
                      value={(mainSets as any)[g]}
                      onChange={(e) =>
                        setMainSets((ms: any) => ({ ...ms, [g]: e.target.value }))
                      }
                      className="w-full h-28 p-2 rounded-lg border font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Se il testo <span className="font-mono">non contiene [MAIN]</span>,
                l’allenamento viene considerato uguale per tutti i gruppi.
              </div>
            </div>

            <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
              <label className="flex items-center justify-between bg-gray-100 rounded-xl px-3 py-2">
                <span>Pace base (sec/100m)</span>
                <input
                  type="number"
                  min={50}
                  max={180}
                  value={pace100}
                  onChange={(e) => setPace100(parseInt(e.target.value || "0", 10))}
                  className="w-20 rounded-lg border px-2 py-1"
                />
              </label>
              <label className="flex items-center justify-between bg-gray-100 rounded-xl px-3 py-2">
                <span>Rest extra (%)</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={restPct}
                  onChange={(e) => setRestPct(parseInt(e.target.value || "0", 10))}
                  className="w-20 rounded-lg border px-2 py-1"
                />
              </label>
              <label className="flex items-center justify-between bg-gray-100 rounded-xl px-3 py-2">
                <span>RPE (0–10)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={rpe}
                  onChange={(e) => setRpe(parseInt(e.target.value || "0", 10))}
                  className="w-20 rounded-lg border px-2 py-1"
                />
              </label>
            </div>
          </div>

          {/* Statistiche */}
          <div className="bg-white rounded-2xl shadow p-3 sm:p-4">
            <div className="border-b pb-2 mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Statistiche</div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-100 rounded-xl p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Volume (testo)
                  </div>
                  <div className="text-2xl font-semibold">
                    {(totals.meters || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">metri</div>
                </div>
                <div className="bg-gray-100 rounded-xl p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Durata (testo)
                  </div>
                  <div className="text-2xl font-semibold">
                    {formatHMM(totals.durationSec)}
                  </div>
                  <div className="text-xs text-gray-500">hh:mm</div>
                </div>
                <div className="bg-gray-100 rounded-xl p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Session Load
                  </div>
                  <div className="text-2xl font-semibold">{sessionLoad}</div>
                  <div className="text-xs text-gray-500">Foster</div>
                </div>
              </div>

              {/* Stili */}
              <section>
                <div className="font-semibold mb-2">Stili</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Free</span>
                    <span>{totals.byStroke.free.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Mix</span>
                    <span>{totals.byStroke.mix.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Fly</span>
                    <span>{totals.byStroke.fly.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Back</span>
                    <span>{totals.byStroke.back.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Breast</span>
                    <span>{totals.byStroke.breast.toLocaleString()}</span>
                  </div>
                </div>
              </section>

              {/* Tipologie */}
              <section className="mt-3">
                <div className="font-semibold mb-2">Tipologie</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Swim</span>
                    <span>{totals.byType.swim.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Pull</span>
                    <span>{totals.byType.pull.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Kick</span>
                    <span>{totals.byType.kick.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2">
                    <span>Tecnica</span>
                    <span>{totals.byType.tech.toLocaleString()}</span>
                  </div>
                </div>
              </section>

              {/* Zone */}
              <section className="mt-3">
                <div className="font-semibold mb-2">Intensità</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  {(["A1","A2","B1","B2","C1","C2"] as const).map((z) => (
                    <div
                      key={z}
                      className="flex items-center justify-between bg-gray-50 border rounded-xl px-3 py-2"
                    >
                      <span>{z}</span>
                      <span>{totals.byZone[z].toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-1">Easy = A1+A2</div>
              </section>

              {/* Volumi per gruppo */}
              <section className="mt-4">
                <div className="font-semibold mb-2">
                  Volumi per gruppo (Pre + Main + Post)
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Se il testo NON contiene <span className="font-mono">[MAIN]</span>, la seduta vale uguale per tutti i gruppi.
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm border rounded-xl overflow-hidden">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2 border">Gruppo</th>
                        <th className="text-right px-3 py-2 border">Pre</th>
                        <th className="text-right px-3 py-2 border">Main</th>
                        <th className="text-right px-3 py-2 border">Post</th>
                        <th className="text-right px-3 py-2 border">Totale</th>
                        <th className="text-right px-3 py-2 border">Durata</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["Velocisti","Mezzofondo","Salvamento"] as const).map((g) => (
                        <tr key={g} className="odd:bg-white even:bg-gray-50">
                          <td className="px-3 py-2 border">{g}</td>
                          <td className="px-3 py-2 border text-right">
                            {(scenario.perGroup[g]?.pre || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 border text-right">
                            {(scenario.perGroup[g]?.main || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 border text-right">
                            {(scenario.perGroup[g]?.post || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 border text-right font-semibold">
                            {(scenario.perGroup[g]?.total || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 border text-right">
                            {formatHMM(scenario.perGroup[g]?.durationSec || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Zone per gruppo */}
              <section className="mt-4">
                <div className="font-semibold mb-2">
                  Intensità per gruppo (metri per zona)
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Calcolo separato per ogni gruppo: <strong>Pre + Main(gruppo) + Post</strong>.
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm border rounded-xl overflow-hidden">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2 border">Gruppo</th>
                        {(["A1","A2","B1","B2","C1","C2"] as const).map((z) => (
                          <th key={z} className="text-right px-3 py-2 border">
                            {z}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 border">Totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["Velocisti","Mezzofondo","Salvamento"] as const).map((g) => (
                        <tr key={g} className="odd:bg-white even:bg-gray-50">
                          <td className="px-3 py-2 border">{g}</td>
                          {(["A1","A2","B1","B2","C1","C2"] as const).map((z) => (
                            <td key={z} className="px-3 py-2 border text-right">
                              {(scenario.perGroup[g]?.zones?.[z] || 0).toLocaleString()}
                            </td>
                          ))}
                          <td className="px-3 py-2 border text-right font-semibold">
                            {(scenario.perGroup[g]?.total || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Righe parse */}
              <section className="mt-4">
                <div className="font-semibold mb-2">Riconoscimento righe & tempi set</div>
                <div className="space-y-1 max-h-56 overflow-auto pr-1">
                  {parsed.length === 0 && (
                    <div className="text-sm text-gray-500">
                      Nessuna riga valida trovata. Scrivi ad es. "12x50 stile @1:00"
                    </div>
                  )}
                  {parsed.map((p, i) => (
                    <div
                      key={i}
                      className="text-xs bg-gray-50 border rounded-lg px-2 py-1 flex flex-wrap gap-x-2 gap-y-1 items-center"
                    >
                      <span className="font-mono">{p.line}</span>
                      <span className="ml-auto font-semibold">{p.meters} m</span>
                      <span className="px-2 py-0.5 bg-blue-100 rounded-full">{p.stroke}</span>
                      <span className="px-2 py-0.5 bg-emerald-100 rounded-full">{p.type}</span>
                      {p.zone && (
                        <span className="px-2 py-0.5 bg-amber-100 rounded-full">{p.zone}</span>
                      )}
                      {p.intervalSec > 0 && (
                        <span className="px-2 py-0.5 bg-purple-100 rounded-full">
                          @{formatHMM(p.intervalSec)}
                        </span>
                      )}
                      <span className="px-2 py-0.5 bg-gray-200 rounded-full">
                        ⏱ {formatHMM(setDurationSec(p as any, pace100, restPct / 100))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-xs text-gray-500">
          • Usa la riga <span className="font-mono">[MAIN]</span> per differenziare il{" "}
          <strong>Lavoro Centrale</strong> tra i gruppi. Se non la usi, il testo vale uguale per tutti.
          <br />• Sintassi: "3x100 stile @1:45", "12x50 mx @1:10", "300 sciolti", "4x50 pull".
        </div>
      </div>
    </div>
  );
}
