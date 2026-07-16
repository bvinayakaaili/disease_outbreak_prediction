import React, { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line } from "recharts";
import { Calendar, AlertTriangle, RefreshCw, BarChart2, CheckCircle, Info } from "lucide-react";

const API_BASE = window.location.port === "5173" ? "http://localhost:8000" : "";

const HistoricalBacktester = ({ countries, selectedCountryIso, setSelectedCountryIso }) => {
  const [modelType, setModelType] = useState("rf");
  const [waves, setWaves] = useState([]);
  const [selectedWaveId, setSelectedWaveId] = useState("");
  const [waveData, setWaveData] = useState([]);
  const [loadingWave, setLoadingWave] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState("");
  const [availablePlaces, setAvailablePlaces] = useState([]);
  
  // Backtest state
  const [backtestData, setBacktestData] = useState(null);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [backtestError, setBacktestError] = useState(null);

  // Fetch wave list on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/historical/waves`)
      .then(res => res.json())
      .then(data => {
        setWaves(data);
        // Default to India Delta wave
        if (data.length > 0) {
          setSelectedWaveId(data[0].id);
        }
      })
      .catch(err => console.error("Error fetching waves:", err));
  }, []);

  // Fetch data for selected wave
  const activeWave = useMemo(() => {
    return waves.find(w => w.id === selectedWaveId);
  }, [waves, selectedWaveId]);

  useEffect(() => {
    if (!activeWave) return;
    
    setLoadingWave(true);
    // Fetch historical data for wave country
    fetch(`${API_BASE}/api/historical/data?country=${activeWave.country_code}`)
      .then(res => res.json())
      .then(data => {
        // Filter data to wave start and end date
        const filtered = data.filter(d => d.date >= activeWave.start_date && d.date <= activeWave.end_date);
        
        // Format dates
        const formatted = filtered.map(d => ({
          ...d,
          formatted_date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          // We plot smoothed cases
          "Daily Cases (Smoothed)": d.new_cases_smoothed || 0,
          "Daily Deaths (Smoothed)": d.new_deaths_smoothed || 0
        }));
        setWaveData(formatted);
      })
      .catch(err => console.error(err))
      .finally(() => {
        setLoadingWave(false);
      });
  }, [activeWave]);

  // Run 2022 backtest for selected country
  const runBacktest = () => {
    if (!selectedCountryIso) return;
    
    setLoadingBacktest(true);
    setBacktestError(null);
    setBacktestData(null);
    
    const url = new URL(`${API_BASE}/api/historical/backtest`);
    url.searchParams.set('country', selectedCountryIso);
    url.searchParams.set('model_type', modelType);
    if (selectedPlace) {
      url.searchParams.set('place', selectedPlace);
    }

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("Could not execute backtest. Verify data availability.");
        return res.json();
      })
      .then(data => {
        // Format timeseries for charting: merge simulated and actual
        const timeseries = data.dates.map((date, idx) => ({
          date,
          formatted_date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          "Simulated Cases": Math.round(data.simulated.cases[idx]),
          "Actual Cases": data.actual.cases[idx] || 0,
          "Simulated Deaths": Math.round(data.simulated.deaths[idx]),
          "Actual Deaths": data.actual.deaths[idx] || 0
        }));
        
        setBacktestData({
          timeseries,
          metrics: data.metrics
        });
      })
      .catch(err => {
        console.error(err);
        setBacktestError("Failed to load backtest. The country might lack sufficient 2022 historical/mobility data.");
      })
      .finally(() => {
        setLoadingBacktest(false);
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

  // Run initial backtest on load or country select or model change
  useEffect(() => {
    if (selectedCountryIso) {
      runBacktest();
    }
  }, [selectedCountryIso, selectedPlace, modelType]);


  return (
    <div className="space-y-6">
      
      {/* Wave Explorer Section */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-400" />
          Annotated Outbreak Wave Explorer
        </h2>
        
        {/* Preset Selection Buttons */}
        <div className="flex flex-wrap gap-2">
          {waves.map(w => (
            <button
              key={w.id}
              onClick={() => setSelectedWaveId(w.id)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all border ${
                selectedWaveId === w.id
                  ? "bg-indigo-600 border-indigo-500 text-slate-100 shadow-lg shadow-indigo-500/10"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {w.country_name} — {w.wave_name}
            </button>
          ))}
        </div>

        {/* Wave Details */}
        {activeWave && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
            <div className="lg:col-span-1 space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-900 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-200">{activeWave.country_name}</h3>
                <div className="text-xs text-indigo-400 font-semibold mt-0.5">{activeWave.wave_name}</div>
                <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                  {activeWave.description}
                </p>
              </div>
              <div className="text-[11px] text-slate-500 border-t border-slate-900 pt-3 space-y-1">
                <div><span className="text-slate-400 font-semibold">Start:</span> {activeWave.start_date}</div>
                <div><span className="text-slate-400 font-semibold">Peak:</span> {activeWave.peak_date} ({activeWave.peak_cases.toLocaleString()} cases)</div>
                <div><span className="text-slate-400 font-semibold">End:</span> {activeWave.end_date}</div>
              </div>
            </div>

            {/* Wave Chart */}
            <div className="lg:col-span-2 h-72 bg-slate-950/40 p-4 rounded-xl border border-slate-900/60 relative">
              {loadingWave ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  Loading wave timeline...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={waveData} margin={{ top: 10, right: 10, left: 15, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorCases" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
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
                      itemStyle={{ color: "#06b6d4" }}
                      labelClassName="text-slate-400 text-xs"
                    />
                    <Legend verticalAlign="top" height={36} iconSize={10} wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Area 
                      type="monotone" 
                      dataKey="Daily Cases (Smoothed)" 
                      stroke="#06b6d4" 
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorCases)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Model Backtesting Section */}
      <div className="glass-card p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-indigo-400" />
              Model Backtester (2022 Outbreaks)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Backtest the compartmental SEIRD equations driven by the ML-calibrated transmission multipliers against actual 2022 historical curves.
            </p>
          </div>
          
          {/* Model & Country Selection */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Calibration Model:</span>
              <select
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 transition-all font-sans"
              >
                <option value="rf">Random Forest (Machine Learning)</option>
                <option value="xgboost">XGBoost (Gradient Boosting)</option>
                <option value="lstm">LSTM (Deep Learning)</option>
                <option value="arima">ARIMA(1, 1, 1) (Time Series)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Target Country:</span>
              <select
                value={selectedCountryIso || ""}
                onChange={(e) => setSelectedCountryIso(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 transition-all font-sans"
              >
                <option value="" disabled>Select a country</option>
                {countries.map(c => (
                  <option key={c.iso_code} value={c.iso_code}>{c.country}</option>
                ))}
              </select>
            </div>

            {availablePlaces.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Place:</span>
                <select
                  value={selectedPlace}
                  onChange={(e) => setSelectedPlace(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 transition-all font-sans"
                >
                  <option value="">Country-wide</option>
                  {availablePlaces.map(place => (
                    <option key={place.place} value={place.place}>{place.place}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Backtester Results */}
        {loadingBacktest ? (
          <div className="h-96 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
            Executing solver integration & predicting parameters...
          </div>
        ) : backtestError ? (
          <div className="h-64 flex flex-col items-center justify-center text-rose-400/80 text-xs text-center p-4">
            <AlertTriangle className="w-8 h-8 text-rose-500 mb-2" />
            {backtestError}
          </div>
        ) : backtestData ? (
          <div className="space-y-6">
            
            {/* Validation Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-900/20 border border-slate-800/40 p-4 rounded-xl">
              <div className="space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-semibold">2022 Backtest CFR</span>
                <div className="text-lg font-bold font-mono text-rose-400">
                  {(backtestData.metrics.cfr * 100).toFixed(2)}%
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-semibold">Infectious Period</span>
                <div className="text-lg font-bold font-mono text-slate-300">
                  {backtestData.metrics.infectious_period} Days
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-semibold">Incubation Period</span>
                <div className="text-lg font-bold font-mono text-slate-300">
                  {backtestData.metrics.incubation_period} Days
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-semibold">Initial Deaths (2022-01-01)</span>
                <div className="text-lg font-bold font-mono text-slate-300">
                  {backtestData.metrics.initial_deaths.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Backtest Charts (Cases and Deaths Side-by-Side) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Cumulative Cases Chart */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-900 space-y-2">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Cumulative Cases: Simulated vs Actual
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={backtestData.timeseries} margin={{ top: 10, right: 10, left: 15, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis 
                        dataKey="formatted_date" 
                        stroke="#64748b" 
                        fontSize={9} 
                        tickLine={false} 
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={9} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(val) => val >= 1e6 ? `${(val/1e6).toFixed(1)}M` : val >= 1e3 ? `${(val/1e3).toFixed(0)}k` : val}
                      />
                      <Tooltip 
                        contentStyle={{ bg: "#020617", border: "1px solid #334155", color: "#f8fafc", fontFamily: "sans-serif" }}
                        labelClassName="text-slate-400 text-xs"
                      />
                      <Legend verticalAlign="top" height={36} iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                      <Line 
                        type="monotone" 
                        dataKey="Simulated Cases" 
                        stroke="#818cf8" 
                        strokeWidth={2}
                        dot={false} 
                      />
                      <Line 
                        type="monotone" 
                        dataKey="Actual Cases" 
                        stroke="#06b6d4" 
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false} 
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Cumulative Deaths Chart */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-900 space-y-2">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Cumulative Deaths: Simulated vs Actual
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={backtestData.timeseries} margin={{ top: 10, right: 10, left: 15, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis 
                        dataKey="formatted_date" 
                        stroke="#64748b" 
                        fontSize={9} 
                        tickLine={false} 
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={9} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(val) => val >= 1e6 ? `${(val/1e6).toFixed(1)}M` : val >= 1e3 ? `${(val/1e3).toFixed(0)}k` : val}
                      />
                      <Tooltip 
                        contentStyle={{ bg: "#020617", border: "1px solid #334155", color: "#f8fafc", fontFamily: "sans-serif" }}
                        labelClassName="text-slate-400 text-xs"
                      />
                      <Legend verticalAlign="top" height={36} iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                      <Line 
                        type="monotone" 
                        dataKey="Simulated Deaths" 
                        stroke="#f43f5e" 
                        strokeWidth={2}
                        dot={false} 
                      />
                      <Line 
                        type="monotone" 
                        dataKey="Actual Deaths" 
                        stroke="#fda4af" 
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false} 
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Backtest Explanatory Note & Comparison Table */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-indigo-950/20 border border-indigo-900/40 rounded-xl text-slate-400 text-xs">
              <div className="flex items-start gap-3 leading-relaxed">
                <Info className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-300">Scientific Calibration Insights:</span>
                  <p className="mt-1">
                    During 2022, the COVID-19 pandemic saw the global emergence of the Omicron variant. Omicron possessed a drastically higher intrinsic transmission rate ($R_0$) and lower case fatality rate than ancestral and Delta variants. Because the ML calibration model was trained on historical relationships, it occasionally underestimates the raw transmissibility of Omicron waves where lockdowns relaxed. This showcases why static models fail without dynamic biological parameter adjustments.
                  </p>
                </div>
              </div>

              <div className="space-y-2 border-t md:border-t-0 md:border-l border-slate-800/80 pt-4 md:pt-0 md:pl-6">
                <span className="font-semibold text-slate-300">Model Performance Comparison (2022 Outbreaks):</span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Comparing active-covariate regressors (RF, XGBoost), sequential deep learning (LSTM), and univariate time series (ARIMA):
                </p>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500">
                        <th className="pb-1 font-semibold">Country</th>
                        <th className="pb-1 font-semibold">RF $R^2$</th>
                        <th className="pb-1 font-semibold">XGBoost $R^2$</th>
                        <th className="pb-1 font-semibold">LSTM $R^2$</th>
                        <th className="pb-1 font-semibold">ARIMA $R^2$</th>
                        <th className="pb-1 font-semibold">Winner</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/50 text-slate-300">
                      <tr>
                        <td className="py-1.5 font-medium text-slate-400">India (IND)</td>
                        <td className="py-1.5 text-emerald-400 font-mono">68.27%</td>
                        <td className="py-1.5 text-slate-400 font-mono">37.09%</td>
                        <td className="py-1.5 text-slate-400 font-mono">9.96%</td>
                        <td className="py-1.5 text-rose-400 font-mono">-1304.56%</td>
                        <td className="py-1.5 text-emerald-400 font-semibold">Random Forest</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-medium text-slate-400">United States (USA)</td>
                        <td className="py-1.5 text-slate-400 font-mono">7.44%</td>
                        <td className="py-1.5 text-emerald-400 font-mono">23.29%</td>
                        <td className="py-1.5 text-rose-400 font-mono">-9.29%</td>
                        <td className="py-1.5 text-rose-400 font-mono">-588.82%</td>
                        <td className="py-1.5 text-emerald-400 font-semibold">XGBoost</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-medium text-slate-400">Germany (DEU)</td>
                        <td className="py-1.5 text-slate-400 font-mono">27.06%</td>
                        <td className="py-1.5 text-emerald-400 font-mono">27.85%</td>
                        <td className="py-1.5 text-slate-400 font-mono">12.59%</td>
                        <td className="py-1.5 text-rose-400 font-mono">-355.83%</td>
                        <td className="py-1.5 text-emerald-400 font-semibold">XGBoost</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-500 italic mt-2 leading-relaxed">
                  *LSTM sequence tracking significantly beats ARIMA due to learning temporal dependencies, but lags behind gradient boosting (XGBoost) and RF on pure tabular regression accuracy.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
            Select a country above to view the backtest comparison.
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoricalBacktester;
