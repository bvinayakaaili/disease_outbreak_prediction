import React, { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line } from "recharts";
import { Play, RotateCcw, AlertTriangle, ShieldCheck, HeartPulse, HelpCircle, RefreshCw } from "lucide-react";

const API_BASE = window.location.port === "5173" ? "http://localhost:8000" : "";

// Presets configurations
const DISEASE_PRESETS = {
  flu: {
    name: "Seasonal Influenza",
    r0: 1.3,
    incubation: 2.0,
    infectious: 4.0,
    cfr: 0.001, // 0.1%
  },
  measles: {
    name: "Measles",
    r0: 15.0,
    incubation: 10.0,
    infectious: 8.0,
    cfr: 0.002, // 0.2%
  },
  covid: {
    name: "COVID-19 (Delta Variant)",
    r0: 5.5,
    incubation: 5.0,
    infectious: 7.0,
    cfr: 0.015, // 1.5%
  },
  novel: {
    name: "Novel Pathogen X (Template)",
    r0: 3.5,
    incubation: 6.0,
    infectious: 9.0,
    cfr: 0.045, // 4.5%
  },
  custom: {
    name: "Custom Pathogen Parameters",
    r0: 2.5,
    incubation: 5.0,
    infectious: 7.0,
    cfr: 0.01, // 1.0%
  }
};

const SimulationLab = ({ countries }) => {
  // Pathogen variables
  const [preset, setPreset] = useState("covid");
  const [population, setPopulation] = useState(10000000);
  const [initialInfected, setInitialInfected] = useState(100);
  const [r0, setR0] = useState(5.5);
  const [incubation, setIncubation] = useState(5.0);
  const [infectious, setInfectious] = useState(7.0);
  const [cfr, setCfr] = useState(1.5);
  const [tMax, setTMax] = useState(180);

  // Intervention variables
  const [hasIntervention, setHasIntervention] = useState(true);
  const [interventionStart, setInterventionStart] = useState(30);
  const [interventionDuration, setInterventionDuration] = useState(60);
  const [stringency, setStringency] = useState(50);
  const [workplaceMobility, setWorkplaceMobility] = useState(-30);
  const [groceryMobility, setGroceryMobility] = useState(-20);

  // Calibration settings
  const [useMl, setUseMl] = useState(true);
  const [selectedCountryIso, setSelectedCountryIso] = useState("IND"); // Default to India
  const [selectedPlace, setSelectedPlace] = useState("");
  const [availablePlaces, setAvailablePlaces] = useState([]);
  const [vulnerabilityMult, setVulnerabilityMult] = useState(1.0);

  // Results
  const [simResults, setSimResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Sync sliders when preset changes
  useEffect(() => {
    if (preset === "custom") return;
    const p = DISEASE_PRESETS[preset];
    setR0(p.r0);
    setIncubation(p.incubation);
    setInfectious(p.infectious);
    setCfr(p.cfr * 100);
  }, [preset]);

  // If user modifies parameter manually, set preset to custom
  const adjustParam = (setter, val) => {
    setter(val);
    setPreset("custom");
  };

  // Run solver
  const runSimulation = () => {
    setLoading(true);
    setError(null);

    const payload = {
      population: parseFloat(population),
      initial_infected: parseFloat(initialInfected),
      r0: parseFloat(r0),
      incubation_period: parseFloat(incubation),
      infectious_period: parseFloat(infectious),
      cfr: parseFloat(cfr) / 100.0,
      t_max: parseInt(tMax),
      use_ml_multiplier: useMl,
      vulnerability_multiplier: parseFloat(vulnerabilityMult),
      iso_code: selectedCountryIso || null,
      place: selectedPlace || null,
      intervention: hasIntervention ? {
        start_day: parseInt(interventionStart),
        duration: parseInt(interventionDuration),
        grocery_mobility: parseFloat(groceryMobility),
        workplace_mobility: parseFloat(workplaceMobility),
        stringency: parseFloat(stringency)
      } : null
    };

    fetch(`${API_BASE}/api/simulation/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(res => {
        if (!res.ok) throw new Error("Solver engine encountered integration error.");
        return res.json();
      })
      .then(data => {
        // Map curves into chart-compatible format
        const chartData = data.t.map((day, idx) => ({
          Day: Math.round(day),
          Susceptible: Math.round(data.S[idx]),
          Exposed: Math.round(data.E[idx]),
          Infectious: Math.round(data.I[idx]),
          Recovered: Math.round(data.R[idx]),
          Deceased: Math.round(data.D[idx])
        }));
        
        setSimResults({
          chartData,
          peakDay: data.peak_day,
          peakInfections: data.peak_infections,
          totalCases: data.total_cases,
          totalDeaths: data.total_deaths
        });
      })
      .catch(err => {
        console.error(err);
        setError("Simulation failed. Check variables range or server connectivity.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!selectedCountryIso) return;
    fetch(`${API_BASE}/api/places?country=${selectedCountryIso}`)
      .then(res => res.json())
      .then(data => {
        setAvailablePlaces(data || []);
        setSelectedPlace("");
      })
      .catch(() => setAvailablePlaces([]));
  }, [selectedCountryIso]);

  // Run on first load
  useEffect(() => {
    runSimulation();
  }, []);

  // Country details lookup for description
  const activeCountry = useMemo(() => {
    return countries.find(c => c.iso_code === selectedCountryIso);
  }, [countries, selectedCountryIso]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      
      {/* Parameters Control Panel (Left column) */}
      <div className="xl:col-span-1 space-y-6">
        
        {/* Pathogen Configuration Card */}
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
            <HeartPulse className="w-5 h-5 text-indigo-400" />
            Pathogen Profile
          </h2>
          
          {/* Preset Selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 uppercase font-semibold">Pathogen Template</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-sm px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              {Object.keys(DISEASE_PRESETS).map(k => (
                <option key={k} value={k}>{DISEASE_PRESETS[k].name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            
            {/* R0 */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                <span>R0 (Transmissibility)</span>
                <span className="text-cyan-400 font-bold">{r0.toFixed(1)}</span>
              </div>
              <input
                type="range" min="0.5" max="18.0" step="0.1" value={r0}
                onChange={(e) => adjustParam(setR0, parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* CFR */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                <span>Fatality Rate (CFR)</span>
                <span className="text-rose-400 font-bold">{cfr.toFixed(2)}%</span>
              </div>
              <input
                type="range" min="0.01" max="25.0" step="0.05" value={cfr}
                onChange={(e) => adjustParam(setCfr, parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Incubation Period */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                <span>Incubation (Days)</span>
                <span className="text-slate-200 font-mono">{incubation.toFixed(0)}d</span>
              </div>
              <input
                type="range" min="1" max="21" step="1" value={incubation}
                onChange={(e) => adjustParam(setIncubation, parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Infectious Period */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                <span>Infectious (Days)</span>
                <span className="text-slate-200 font-mono">{infectious.toFixed(0)}d</span>
              </div>
              <input
                type="range" min="1" max="21" step="1" value={infectious}
                onChange={(e) => adjustParam(setInfectious, parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-900 pt-3">
            {/* Population Size */}
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 uppercase font-semibold">Population Size</label>
              <select
                value={population}
                onChange={(e) => setPopulation(parseInt(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-xs px-2 py-1.5 focus:outline-none"
              >
                <option value={100000}>100,000 (City)</option>
                <option value={1000000}>1,000,000 (Metro)</option>
                <option value={10000000}>10,000,000 (Region)</option>
                <option value={50000000}>50,000,000 (Country)</option>
              </select>
            </div>

            {/* Initial Infected */}
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 uppercase font-semibold">Initial Infected</label>
              <input
                type="number" value={initialInfected}
                onChange={(e) => setInitialInfected(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-xs px-2 py-1.5 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Demographics Calibration Card */}
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
            <ShieldCheck className="w-5 h-5 text-indigo-400" />
            Demographics & Vulnerability
          </h2>
          
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Use ML-Derived Multipliers</span>
            <input 
              type="checkbox" checked={useMl} onChange={(e) => setUseMl(e.target.checked)}
              className="w-4 h-4 rounded border-slate-850 bg-slate-950 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 uppercase font-semibold">Calibrate against Country</label>
            <select
              value={selectedCountryIso || ""}
              onChange={(e) => setSelectedCountryIso(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-xs px-3 py-2 focus:outline-none"
            >
              <option value="">Global Median (Non-calibrated)</option>
              {countries.map(c => (
                <option key={c.iso_code} value={c.iso_code}>{c.country}</option>
              ))}
            </select>
          </div>

          {availablePlaces.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase font-semibold">Specific Place</label>
              <select
                value={selectedPlace}
                onChange={(e) => setSelectedPlace(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-xs px-3 py-2 focus:outline-none"
              >
                <option value="">Country-wide baseline</option>
                {availablePlaces.map(place => (
                  <option key={place.place} value={place.place}>{place.place}</option>
                ))}
              </select>
            </div>
          )}

          {activeCountry && (
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-900 text-[10px] text-slate-500 space-y-1">
              <div className="flex justify-between">
                <span>Vulnerability OVI:</span>
                <span className="font-semibold text-slate-300">{activeCountry.vulnerability_index.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span>Median Age:</span>
                <span className="font-semibold text-slate-300">{activeCountry.median_age} yrs</span>
              </div>
              <div className="flex justify-between">
                <span>Hospital Beds:</span>
                <span className="font-semibold text-slate-300">{activeCountry.hospital_beds_per_thousand} / 1k</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
              <span>Pathogen Sensitivity Factor</span>
              <span className="text-indigo-400 font-bold">{vulnerabilityMult.toFixed(2)}x</span>
            </div>
            <input
              type="range" min="0.2" max="3.0" step="0.05" value={vulnerabilityMult}
              onChange={(e) => setVulnerabilityMult(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>

        {/* Interventions Card */}
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-100">Government Interventions</h2>
            <input 
              type="checkbox" checked={hasIntervention} onChange={(e) => setHasIntervention(e.target.checked)}
              className="w-4 h-4 rounded border-slate-850 bg-slate-950 text-indigo-500 cursor-pointer"
            />
          </div>

          {hasIntervention && (
            <div className="space-y-4 pt-1 animate-fadeIn">
              
              {/* Start and duration */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                    <span>Start (Day)</span>
                    <span className="text-slate-200">{interventionStart}</span>
                  </div>
                  <input
                    type="range" min="0" max="150" step="1" value={interventionStart}
                    onChange={(e) => setInterventionStart(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                    <span>Duration (Days)</span>
                    <span className="text-slate-200">{interventionDuration}</span>
                  </div>
                  <input
                    type="range" min="10" max="180" step="1" value={interventionDuration}
                    onChange={(e) => setInterventionDuration(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-indigo-500"
                  />
                </div>
              </div>

              {/* Stringency */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                  <span>Stringency Index</span>
                  <span className="text-slate-200">{stringency} / 100</span>
                </div>
                <input
                  type="range" min="0" max="100" step="1" value={stringency}
                  onChange={(e) => setStringency(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-indigo-500"
                />
              </div>

              {/* Mobility Workplace */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                  <span>Workplace Mobility Change</span>
                  <span className={`${workplaceMobility < 0 ? 'text-cyan-400' : 'text-slate-300'} font-bold`}>
                    {workplaceMobility > 0 ? `+${workplaceMobility}` : workplaceMobility}%
                  </span>
                </div>
                <input
                  type="range" min="-80" max="10" step="1" value={workplaceMobility}
                  onChange={(e) => setWorkplaceMobility(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-indigo-500"
                />
              </div>

              {/* Mobility Grocery */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                  <span>Grocery Mobility Change</span>
                  <span className={`${groceryMobility < 0 ? 'text-cyan-400' : 'text-slate-300'} font-bold`}>
                    {groceryMobility > 0 ? `+${groceryMobility}` : groceryMobility}%
                  </span>
                </div>
                <input
                  type="range" min="-80" max="10" step="1" value={groceryMobility}
                  onChange={(e) => setGroceryMobility(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-indigo-500"
                />
              </div>

            </div>
          )}
        </div>

        {/* Buttons */}
        <button
          onClick={runSimulation}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-850 disabled:text-slate-400 text-slate-100 font-bold rounded-xl shadow-xl shadow-indigo-500/10 hover:shadow-indigo-500/20 active:scale-[0.99] transition-all"
        >
          {loading ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5" />
          )}
          Run Compartmental Engine
        </button>

      </div>

      {/* Results Display (Right column - 2xl space) */}
      <div className="xl:col-span-2 space-y-6">
        
        {/* Output Metrics Grid */}
        {simResults && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card p-4">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Peak Infection Day</div>
              <div className="text-2xl font-bold font-mono text-cyan-400 mt-1">
                Day {simResults.peakDay}
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Peak Active Infections</div>
              <div className="text-2xl font-bold font-mono text-indigo-400 mt-1">
                {simResults.peakInfections.toLocaleString()}
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Simulated Cases</div>
              <div className="text-2xl font-bold font-mono text-slate-200 mt-1">
                {simResults.totalCases.toLocaleString()}
              </div>
            </div>
            <div className="glass-card p-4 font-sans">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Projected Deaths</div>
              <div className="text-2xl font-bold font-mono text-rose-400 mt-1">
                {simResults.totalDeaths.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Chart Panel */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Infection Trajectory Curves (SEIRD compartments)
          </h3>
          
          <div className="h-[380px]">
            {loading ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
                Integrating differential equations...
              </div>
            ) : error ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-rose-400 text-xs gap-2">
                <AlertTriangle className="w-8 h-8 text-rose-500" />
                {error}
              </div>
            ) : simResults ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={simResults.chartData} margin={{ top: 10, right: 10, left: 15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="Day" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis 
                    stroke="#64748b" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(val) => val >= 1e6 ? `${(val/1e6).toFixed(1)}M` : val >= 1e3 ? `${(val/1e3).toFixed(0)}k` : val}
                  />
                  <Tooltip 
                    contentStyle={{ bg: "#020617", border: "1px solid #334155", color: "#f8fafc", fontFamily: "sans-serif" }}
                    labelClassName="text-slate-400 text-xs"
                  />
                  <Legend verticalAlign="top" height={36} iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  {/* S */}
                  <Area type="monotone" dataKey="Susceptible" stackId="1" stroke="#334155" fill="#1e293b" fillOpacity={0.15} />
                  {/* E */}
                  <Area type="monotone" dataKey="Exposed" stackId="1" stroke="#f59e0b" fill="#b45309" fillOpacity={0.1} />
                  {/* I */}
                  <Area type="monotone" dataKey="Infectious" stackId="1" stroke="#6366f1" fill="#4338ca" fillOpacity={0.25} />
                  {/* R */}
                  <Area type="monotone" dataKey="Recovered" stackId="1" stroke="#10b981" fill="#047857" fillOpacity={0.15} />
                  {/* D */}
                  <Area type="monotone" dataKey="Deceased" stackId="1" stroke="#f43f5e" fill="#9f1239" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
                No simulation results to display. Click Run.
              </div>
            )}
          </div>

          {/* Intervention Window Highlight */}
          {hasIntervention && simResults && (
            <div className="text-[10px] text-slate-500 flex items-center gap-2 border-t border-slate-900 pt-3">
              <span className="w-3 h-3 bg-indigo-500/20 border border-indigo-500/50 rounded"></span>
              <span>Intervention Window: Day {interventionStart} to {interventionStart + interventionDuration} (Government policies reduce transmission rate beta based on ML correlations).</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimulationLab;
