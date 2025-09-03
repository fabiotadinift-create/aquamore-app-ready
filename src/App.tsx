import React, { useMemo, useState, useEffect } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Allenamenti from "./Allenamenti"; // 👈 nuovo import
import AquamoreLogo from "./AquamoreLogo"; // se hai un logo

// ============ Util ============
const pad2 = (n: number) => (n < 10 ? "0" + n : n.toString());

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Qui ipotizzo che tu abbia già le funzioni `loadAll`, `computeScenarioForData`, ecc.

// ============ App ============
export default function App() {
  // Planner
  const [currentDate, setCurrentDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));

  // Editor (mantieni i tuoi stati già esistenti)
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
      setTitle(data.title);
      setDatetime(data.datetime);
      setGroups(data.groups);
      setTags(data.tags);
      setText(data.text);
      setPace100(data.pace100);
      setRestPct(data.restPct);
      setRpe(data.rpe);
      setMainSets(data.mainSets);
    }
  };

  useEffect(() => {
    loadDay(currentDate);
  }, [currentDate]);

  // Autosave debounce
  useEffect(() => {
    const t = setTimeout(() => {
      const key = dateKey(currentDate);
      saveFor(key, {
        title,
        datetime,
        groups,
        tags,
        text,
        pace100,
        restPct,
        rpe,
        mainSets,
      });
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

  // UI
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
                className={`cursor-pointer border rounded-xl p-2 bg-white hover:bg-gray-50 ${
                  isSel ? "ring-2 ring-blue-500" : ""
                }`}
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
                    {(["Velocisti", "Mezzofondo", "Salvamento"] as const).map(
                      (g) => (
                        <div key={g}>
                          {g.slice(0, 3)}:{" "}
                          <span className="font-semibold">
                            {scen
                              ? (scen.perGroup[g]?.total || 0).toLocaleString()
                              : 0}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 👇 nuova sezione collegata a Google Sheet */}
        <Allenamenti />
      </div>
    </div>
  );
}
