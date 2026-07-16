import React, { useState, useEffect } from "react";
import { Activity, ShieldAlert, LineChart, Cpu, RefreshCw, Layers } from "lucide-react";

// Import our tabs
import LiveDashboard from "./components/LiveDashboard";
import HistoricalBacktester from "./components/HistoricalBacktester";
import SimulationLab from "./components/SimulationLab";
import InsightsPanel from "./components/InsightsPanel";

const API_BASE = window.location.port === "5173" ? "http://localhost:8000" : "";

function App() {
  const [activeTab, setActiveTab] = useState("live");
  
  // Loaded states
  const [countries, setCountries] = useState([]);
  const [liveSummary, setLiveSummary] = useState(null);
  const [liveCountries, setLiveCountries] = useState([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [isDelayed, setIsDelayed] = useState(false);
  
  // Loading & Error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selected country in historical/backtester tab
  const [selectedCountryIso, setSelectedCountryIso] = useState("IND");

  const loadData = () => {
    setError(null);
    
    // Fetch base countries metadata
    const fetchCountries = fetch(`${API_BASE}/api/countries`).then(res => {
      if (!res.ok) throw new Error("Failed to load country metadata.");
      return res.json();
    });

    // Fetch live summary
    const fetchSummary = fetch(`${API_BASE}/api/live/summary`).then(res => {
      if (!res.ok) throw new Error("Failed to load live summary.");
      return res.json();
    });

    // Fetch live countries list
    const fetchLiveCountries = fetch(`${API_BASE}/api/live/countries`).then(res => {
      if (!res.ok) throw new Error("Failed to load live country stats.");
      return res.json();
    });

    Promise.all([fetchCountries, fetchSummary, fetchLiveCountries])
      .then(([countriesRes, summaryRes, liveCountriesRes]) => {
        setCountries(countriesRes);
        setLiveSummary(summaryRes);
        setLiveCountries(liveCountriesRes.countries);
        setLastUpdated(summaryRes.last_updated);
        setIsDelayed(summaryRes.is_delayed);
      })
      .catch(err => {
        console.error(err);
        setError("OutbreakSense API is starting up or database is compiling. If this persists, verify the python backend is running on port 8000.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Initial load
  useEffect(() => {
    loadData();
  }, []);

  // Poll for updates every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      // Quiet poll (no spinner)
      fetch(`${API_BASE}/api/live/summary`)
        .then(res => res.json())
        .then(summaryRes => {
          setLiveSummary(summaryRes);
          setLastUpdated(summaryRes.last_updated);
          setIsDelayed(summaryRes.is_delayed);
          
          return fetch(`${API_BASE}/api/live/countries`);
        })
        .then(res => res.json())
        .then(liveCountriesRes => {
          setLiveCountries(liveCountriesRes.countries);
        })
        .catch(err => console.log("Silent live poller failed:", err));
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  // Handle callback from Map selection
  const handleSelectCountry = (isoCode) => {
    setSelectedCountryIso(isoCode);
    setActiveTab("historical");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 text-sm gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
        <div className="font-semibold tracking-wide uppercase text-xs text-slate-500">Initializing OutbreakSense Dashboard</div>
        <p className="text-[10px] text-slate-600 max-w-xs text-center">
          Loading precomputed compartment metrics and seeding live database endpoints.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-rose-400/80 text-sm gap-4 p-4 text-center">
        <ShieldAlert className="w-12 h-12 text-rose-500" />
        <div className="font-bold text-lg text-slate-200">Database Connection Failed</div>
        <p className="max-w-md text-slate-400 text-xs leading-relaxed">{error}</p>
        <button 
          onClick={() => { setLoading(true); loadData(); }}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-200 border border-slate-800 rounded-lg transition-colors mt-2"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-950">
      
      {/* Sidebar Navigation */}
      <aside className="w-full lg:w-64 bg-slate-950/80 backdrop-blur-xl border-r lg:border-r border-b lg:border-b-0 border-slate-900 p-6 flex flex-col justify-between">
        <div className="space-y-8">
          
          {/* Logo Header */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center text-slate-100 font-black shadow-lg shadow-indigo-500/10">
              Ω
            </div>
            <div>
              <h1 className="font-extrabold text-slate-100 text-lg tracking-tight font-sans">OutbreakSense</h1>
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Calibration Engine</div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="space-y-1.5">
            
            {/* Live Mode */}
            <button
              onClick={() => setActiveTab("live")}
              className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold tracking-wide rounded-lg transition-all ${
                activeTab === "live"
                  ? "bg-indigo-950/30 text-indigo-400 border border-indigo-900/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"
              }`}
            >
              <Activity className="w-4.5 h-4.5" />
              Live Dashboard
            </button>

            {/* Historical Mode */}
            <button
              onClick={() => setActiveTab("historical")}
              className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold tracking-wide rounded-lg transition-all ${
                activeTab === "historical"
                  ? "bg-indigo-950/30 text-indigo-400 border border-indigo-900/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"
              }`}
            >
              <LineChart className="w-4.5 h-4.5" />
              Historical Backtester
            </button>

            {/* Simulation Mode */}
            <button
              onClick={() => setActiveTab("simulation")}
              className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold tracking-wide rounded-lg transition-all ${
                activeTab === "simulation"
                  ? "bg-indigo-950/30 text-indigo-400 border border-indigo-900/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"
              }`}
            >
              <Cpu className="w-4.5 h-4.5" />
              Simulation Lab
            </button>

            {/* Insights Panel */}
            <button
              onClick={() => setActiveTab("insights")}
              className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold tracking-wide rounded-lg transition-all ${
                activeTab === "insights"
                  ? "bg-indigo-950/30 text-indigo-400 border border-indigo-900/60"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"
              }`}
            >
              <Layers className="w-4.5 h-4.5" />
              Insights & Explainability
            </button>

          </nav>
        </div>

        {/* Footer / Status Indicator */}
        <div className="pt-6 border-t border-slate-900 text-[10px] text-slate-500 space-y-1 mt-6 lg:mt-0">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Local Predictor Online</span>
          </div>
          <div>v1.0.0 (FastAPI + SEIRD)</div>
        </div>

      </aside>

      {/* Main Content Dashboard Area */}
      <main className="flex-1 p-6 md:p-8 max-w-7xl overflow-y-auto">
        {activeTab === "live" && (
          <LiveDashboard 
            liveSummary={liveSummary} 
            countriesData={liveCountries} 
            lastUpdated={lastUpdated} 
            isDelayed={isDelayed}
            onSelectCountry={handleSelectCountry}
          />
        )}
        {activeTab === "historical" && (
          <HistoricalBacktester 
            countries={countries} 
            selectedCountryIso={selectedCountryIso} 
            setSelectedCountryIso={setSelectedCountryIso}
          />
        )}
        {activeTab === "simulation" && (
          <SimulationLab countries={countries} />
        )}
        {activeTab === "insights" && (
          <InsightsPanel countries={countries} />
        )}
      </main>

    </div>
  );
}

export default App;
