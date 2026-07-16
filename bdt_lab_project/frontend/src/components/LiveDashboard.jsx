import React, { useState, useEffect, useMemo } from "react";
import { Search, ChevronDown, ChevronUp, AlertCircle, RefreshCw, X, Calendar, Activity, ShieldAlert, Heart } from "lucide-react";
import MapChart from "./MapChart";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const API_BASE = window.location.port === "5173" ? "http://localhost:8000" : "";

// Lightweight pure SVG sparkline component
const Sparkline = ({ data, color = "#6366f1" }) => {
  if (!data || data.length < 2) return <span className="text-slate-600 text-[10px]">Flat trend</span>;
  
  const width = 90;
  const height = 25;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min === 0 ? 1 : max - min;
  
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - 2 - ((val - min) / range) * (height - 4); // add padding
    return `${x},${y}`;
  }).join(" ");
  
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

const LiveDashboard = ({ liveSummary, countriesData, lastUpdated, isDelayed, onSelectCountry }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("cases");
  const [sortOrder, setSortOrder] = useState("desc");
  const [selectedCountryCode, setSelectedCountryCode] = useState(null);
  const [countryHistory, setCountryHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Sorting columns configuration
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  // Filter and Sort country data
  const filteredAndSortedCountries = useMemo(() => {
    return countriesData
      .filter(c => 
        (c.country || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.iso_code || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];
        
        // Handle strings
        if (typeof valA === "string") {
          return sortOrder === "asc" 
            ? valA.localeCompare(valB) 
            : valB.localeCompare(valA);
        }
        
        // Handle numeric/boolean
        valA = valA || 0;
        valB = valB || 0;
        return sortOrder === "asc" ? valA - valB : valB - valA;
      });
  }, [countriesData, searchTerm, sortBy, sortOrder]);

  // Fetch drill-down country history
  useEffect(() => {
    if (!selectedCountryCode) return;
    
    setLoadingHistory(true);
    setHistoryError(null);
    setCountryHistory([]);
    
    fetch(`${API_BASE}/api/live/country/${selectedCountryCode}`)
      .then(res => {
        if (!res.ok) throw new Error("Could not fetch country history.");
        return res.json();
      })
      .then(data => {
        // Format date string for the chart
        const formatted = data.map(d => ({
          ...d,
          formatted_date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        }));
        setCountryHistory(formatted);
      })
      .catch(err => {
        console.error(err);
        setHistoryError("No historical live-polls recorded for this country yet. History builds over time as API is polled.");
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  }, [selectedCountryCode]);

  // Compute stats for selected country
  const selectedCountry = useMemo(() => {
    if (!selectedCountryCode) return null;
    return countriesData.find(c => c.iso_code === selectedCountryCode);
  }, [countriesData, selectedCountryCode]);

  // Global summary counters
  const gSummary = liveSummary?.global || { cases: 0, deaths: 0, recovered: 0, active: 0, today_cases: 0 };

  return (
    <div className="space-y-6">
      
      {/* Delayed / Outage Banner */}
      {isDelayed && (
        <div className="flex items-center gap-3 p-4 bg-amber-950/45 border border-amber-900/60 rounded-xl text-amber-300 text-sm animate-pulse">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div>
            <span className="font-semibold">Data Poller Delayed:</span> The latest request to <code className="bg-slate-900/80 px-1 py-0.5 rounded text-amber-200">disease.sh</code> failed. Displaying cached numbers from the database. The platform will automatically retry.
          </div>
        </div>
      )}

      {/* honest Caveat Banner */}
      <div className="flex items-start gap-3 p-4 bg-slate-900/50 border border-slate-800/80 rounded-xl text-slate-400 text-xs">
        <AlertCircle className="w-5 h-5 flex-shrink-0 text-slate-500 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-300 text-sm flex items-center gap-1.5">
            Honest Data Caveat
          </div>
          <p>
            Please note that global COVID-19 case and death reporting by national healthcare systems is far less frequent and complete than it was during the peak years of 2020–2022. Many countries have transitioned to weekly, monthly, or completely ceased official case counts. As a result, the live curves will appear significantly flatter and under-reported compared to historical waves. This platform processes the data exactly as reported, without hiding these reporting limitations.
          </p>
        </div>
      </div>

      {/* Global Counters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Total Cases */}
        <div className="glass-card p-5 relative overflow-hidden flex flex-col justify-between h-32">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold tracking-wider uppercase">
            <span>Total Confirmed Cases</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-3xl font-extrabold text-cyan-400 mt-2 tracking-tight glow-text-cyan live-pulse">
            {gSummary.cases.toLocaleString()}
          </div>
          <div className="text-[10px] text-cyan-400/80 mt-1 flex items-center gap-1">
            <span className="bg-cyan-950 px-1.5 py-0.5 rounded font-bold">+{gSummary.today_cases.toLocaleString()} today</span>
          </div>
        </div>

        {/* Total Deaths */}
        <div className="glass-card p-5 relative overflow-hidden flex flex-col justify-between h-32">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold tracking-wider uppercase">
            <span>Confirmed Deaths</span>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-3xl font-extrabold text-rose-500 mt-2 tracking-tight glow-text-rose">
            {gSummary.deaths.toLocaleString()}
          </div>
          <div className="text-[10px] text-rose-500/80 mt-1 flex items-center gap-1">
            <span className="bg-rose-950 px-1.5 py-0.5 rounded font-bold">+{gSummary.today_deaths.toLocaleString()} today</span>
          </div>
        </div>

        {/* Total Recovered */}
        <div className="glass-card p-5 relative overflow-hidden flex flex-col justify-between h-32">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold tracking-wider uppercase">
            <span>Total Recovered</span>
            <Heart className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 mt-2 tracking-tight glow-text-emerald">
            {gSummary.recovered.toLocaleString()}
          </div>
          <div className="text-[10px] text-emerald-400/80 mt-1 flex items-center gap-1">
            <span className="bg-emerald-950 px-1.5 py-0.5 rounded font-bold">+{gSummary.today_recovered.toLocaleString()} today</span>
          </div>
        </div>

        {/* Active / Last Polled Info */}
        <div className="glass-card p-5 relative overflow-hidden flex flex-col justify-between h-32 bg-slate-900/20">
          <div className="flex justify-between items-center text-slate-400 text-xs font-semibold tracking-wider uppercase">
            <span>Data Poller Status</span>
            <RefreshCw className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-sm font-semibold text-slate-200 mt-2">
            Active: {gSummary.active.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex flex-col">
            <span>Last Polled:</span>
            <span className="text-slate-300 font-mono">{lastUpdated || "Never"}</span>
          </div>
        </div>
      </div>

      {/* Choropleth Map section */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight text-slate-100 font-sans">Global Distribution Density</h2>
        <MapChart countriesData={countriesData} onSelectCountry={(code) => setSelectedCountryCode(code)} />
      </div>

      {/* Country List Table */}
      <div className="glass-card p-6 space-y-4">
        
        {/* Search and Table Tools */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            Country Risk Analysis
            <span className="bg-slate-800 text-[10px] px-2 py-0.5 rounded-full text-slate-400">
              {filteredAndSortedCountries.length} countries
            </span>
          </h2>
          <div className="relative md:w-80">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search country name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Scrollable Table */}
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-900 z-10 text-xs font-semibold tracking-wider text-slate-400 uppercase border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Country</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("cases")}>
                  <div className="flex items-center gap-1">
                    Total Cases
                    {sortBy === "cases" && (sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("today_cases")}>
                  <div className="flex items-center gap-1">
                    New (Today)
                    {sortBy === "today_cases" && (sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("deaths")}>
                  <div className="flex items-center gap-1">
                    Deaths
                    {sortBy === "deaths" && (sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("vulnerability_index")}>
                  <div className="flex items-center gap-1">
                    OVI (Vulnerability)
                    {sortBy === "vulnerability_index" && (sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("risk_badge")}>
                  <div className="flex items-center gap-1">
                    Trajectory
                    {sortBy === "risk_badge" && (sortOrder === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                  </div>
                </th>
                <th className="py-3 px-4">14-Day Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm text-slate-300">
              {filteredAndSortedCountries.length > 0 ? (
                filteredAndSortedCountries.map((c) => {
                  const badge = c.risk_badge || "stable";
                  
                  return (
                    <tr 
                      key={c.iso_code || c.country} 
                      onClick={() => setSelectedCountryCode(c.iso_code)}
                      className="hover:bg-slate-900/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-slate-100 flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-[10px] bg-slate-900 px-1 py-0.5 rounded">
                          {c.iso_code || "???"}
                        </span>
                        {c.country}
                      </td>
                      <td className="py-3 px-4 font-mono">{(c.cases || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 font-mono text-cyan-400">
                        {c.today_cases > 0 ? `+${c.today_cases.toLocaleString()}` : "0"}
                      </td>
                      <td className="py-3 px-4 font-mono text-rose-400">{(c.deaths || 0).toLocaleString()}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-400 text-xs">{(c.vulnerability_index || 0).toFixed(2)}</span>
                          <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-indigo-500" 
                              style={{ width: `${(c.vulnerability_index || 0) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${
                          badge === "rising" 
                            ? "bg-rose-950/40 border-rose-800/80 text-rose-400 animate-pulse" 
                            : badge === "declining"
                            ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-400"
                            : "bg-slate-950 border-slate-800 text-slate-400"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            badge === "rising" ? "bg-rose-400" : badge === "declining" ? "bg-emerald-400" : "bg-slate-400"
                          }`}></span>
                          {badge}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {c.sparkline && c.sparkline.length > 0 ? (
                          <Sparkline 
                            data={c.sparkline} 
                            color={badge === "rising" ? "#fb7185" : badge === "declining" ? "#34d399" : "#818cf8"} 
                          />
                        ) : (
                          <span className="text-slate-600 text-[10px]">No historical polls</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-slate-500">
                    No matching countries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down Modal */}
      {selectedCountry && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-card w-full max-w-4xl p-6 relative overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                  {selectedCountry.country}
                  <span className="text-sm font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    {selectedCountry.iso_code}
                  </span>
                </h3>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-300">Region OVI:</span> 
                    <span className="text-indigo-400 font-bold">{(selectedCountry.vulnerability_index || 0).toFixed(3)}</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${
                      selectedCountry.risk_badge === "rising" 
                        ? "bg-rose-500 animate-pulse" 
                        : selectedCountry.risk_badge === "declining" ? "bg-emerald-500" : "bg-slate-400"
                    }`}></span>
                    <span className="font-bold tracking-wide uppercase text-slate-300">{selectedCountry.risk_badge || "stable"} risk</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedCountryCode(null)}
                className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-slate-100"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto mt-6 space-y-6 flex-1 pr-1">
              
              {/* Detailed Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/40">
                  <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Live Total Cases</div>
                  <div className="text-xl font-bold font-mono text-slate-200 mt-1">
                    {(selectedCountry.cases || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/40">
                  <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Live Total Deaths</div>
                  <div className="text-xl font-bold font-mono text-rose-400 mt-1">
                    {(selectedCountry.deaths || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/40">
                  <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Case Rate / Million</div>
                  <div className="text-xl font-bold font-mono text-cyan-400 mt-1">
                    {Math.round(selectedCountry.cases_per_million || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/40">
                  <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Population</div>
                  <div className="text-xl font-bold font-mono text-slate-300 mt-1">
                    {Math.round(selectedCountry.population || 0).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Chart of Polled History */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Live Polled Cumulative Cases (Last 30 Days)
                </h4>
                <div className="w-full h-64 bg-slate-950/60 border border-slate-900 p-4 rounded-lg">
                  {loadingHistory ? (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                      Loading history...
                    </div>
                  ) : historyError ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-center p-4">
                      <AlertCircle className="w-6 h-6 text-slate-600 mb-2" />
                      <p className="text-xs max-w-sm">{historyError}</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={countryHistory} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis 
                          dataKey="formatted_date" 
                          stroke="#64748b" 
                          fontSize={10} 
                          tickLine={false} 
                        />
                        <YAxis 
                          stroke="#64748b" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          tickFormatter={(val) => val >= 1e6 ? `${(val/1e6).toFixed(1)}M` : val >= 1e3 ? `${(val/1e3).toFixed(0)}k` : val}
                        />
                        <Tooltip 
                          contentStyle={{ bg: "#020617", border: "1px solid #334155", color: "#f8fafc", fontFamily: "sans-serif" }}
                          itemStyle={{ color: "#818cf8" }}
                          labelClassName="text-slate-400 text-xs"
                          formatter={(value) => [value.toLocaleString(), "Cases"]}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="cases" 
                          stroke="#6366f1" 
                          strokeWidth={2.5} 
                          dot={false}
                          activeDot={{ r: 5, fill: "#818cf8" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Vulnerability Breakdown Details */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-indigo-400" />
                  Demographic Vulnerability Breakdown
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-900/40 border border-slate-800/40 p-4 rounded-lg">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-1.5">
                      <span className="text-slate-400">Median Age</span>
                      <span className="font-semibold text-slate-200">{(selectedCountry.median_age || 0).toFixed(1)} years</span>
                    </div>
                    <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-1.5">
                      <span className="text-slate-400">Human Development Index (HDI)</span>
                      <span className="font-semibold text-slate-200">{(selectedCountry.human_development_index || 0).toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Hospital Beds per Thousand</span>
                      <span className="font-semibold text-slate-200">{(selectedCountry.hospital_beds_per_thousand || 0).toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-1.5">
                      <span className="text-slate-400">Population Density</span>
                      <span className="font-semibold text-slate-200">{(selectedCountry.population_density || 0).toFixed(1)} / km²</span>
                    </div>
                    <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-1.5">
                      <span className="text-slate-400">OVI Risk Subscores</span>
                      <span className="font-semibold text-slate-200">
                        {selectedCountry.vulnerability_index > 0.65 ? "High" : selectedCountry.vulnerability_index > 0.4 ? "Moderate" : "Low"}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 leading-relaxed pt-1">
                      *OVI represents healthcare and demographic vulnerability. Older populations, fewer hospital beds, and lower socioeconomic HDI capacity scores yield higher risk metrics.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-800 pt-4 mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (onSelectCountry) onSelectCountry(selectedCountry.iso_code);
                  setSelectedCountryCode(null);
                }}
                className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-slate-100 rounded-lg shadow-lg hover:shadow-indigo-500/10 transition-all"
              >
                Analyze in Simulation/Historical Mode
              </button>
              <button 
                onClick={() => setSelectedCountryCode(null)}
                className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveDashboard;
