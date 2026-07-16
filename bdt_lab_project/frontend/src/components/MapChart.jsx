import React, { useState, memo } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleLog } from "d3-scale";

// Standard 110m world atlas TopoJSON
const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Country name mapping overrides between world-atlas and our API
const mapNameOverrides = {
  "united states of america": "usa",
  "united kingdom": "gbr",
  "dem. rep. congo": "cod",
  "congo": "cog",
  "central african rep.": "caf",
  "s. sudan": "ssd",
  "dominican rep.": "dom",
  "falkland is.": "flk",
  "greenland": "grl",
  "w. sahara": "esh",
  "equatorial guinea": "gnq",
  "swaziland": "swz",
  "new caledonia": "ncl",
  "solomon is.": "slb",
  "papua new guinea": "png",
  "bosnia and herz.": "bih",
  "macedonia": "mkd",
  "ivory coast": "civ",
  "cote d'ivoire": "civ",
  "myanmar": "mmr",
  "laos": "lao",
  "syria": "syr",
  "north korea": "prk",
  "south korea": "kor",
  "vietnam": "vnm"
};

const MapChart = ({ countriesData, onSelectCountry }) => {
  const [tooltipContent, setTooltipContent] = useState("");
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Map country data by ISO3 and lowercased name for reliable lookups
  const countryMapByIso = {};
  const countryMapByName = {};
  
  countriesData.forEach(c => {
    if (c.iso_code) countryMapByIso[c.iso_code.toUpperCase()] = c;
    if (c.country) countryMapByName[c.country.toLowerCase()] = c;
  });

  // Calculate min and max for case rate to scale the log color function
  const caseRates = countriesData
    .map(c => c.cases_per_million)
    .filter(rate => rate > 0);
    
  const minRate = Math.min(...caseRates, 100);
  const maxRate = Math.max(...caseRates, 500000);

  // Log scale is much better for pandemic rates to see differences between orders of magnitude
  const colorScale = scaleLog()
    .domain([minRate, maxRate])
    .range(["#0e7490", "#e11d48"]); // Cyan-700 to Rose-600

  const handleMouseEnter = (geo, event) => {
    const geoName = geo.properties.name;
    const lowerName = geoName.toLowerCase();
    
    // Find matching country
    let country = countryMapByName[lowerName];
    if (!country && mapNameOverrides[lowerName]) {
      const override = mapNameOverrides[lowerName];
      country = countryMapByIso[override.toUpperCase()] || countryMapByName[override];
    }
    
    if (country) {
      const rate = country.cases_per_million ? Math.round(country.cases_per_million).toLocaleString() : "N/A";
      const total = country.cases ? country.cases.toLocaleString() : "N/A";
      const deaths = country.deaths ? country.deaths.toLocaleString() : "N/A";
      const badge = country.risk_badge ? country.risk_badge.toUpperCase() : "STABLE";
      
      setTooltipContent(`
        <div class="p-3 text-xs bg-slate-950/95 border border-slate-800 rounded-lg shadow-xl font-sans text-slate-100">
          <div class="font-bold text-sm text-indigo-400 mb-1">${country.country}</div>
          <div class="flex items-center gap-1.5 mb-2">
            <span class="w-2 h-2 rounded-full ${
              badge === "RISING" ? "bg-red-500 animate-pulse" : badge === "DECLINING" ? "bg-emerald-500" : "bg-cyan-500"
            }"></span>
            <span class="text-[10px] font-semibold text-slate-400">${badge} RISK</span>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1">
            <span class="text-slate-400">Cases/M:</span> <span class="font-semibold text-cyan-400 text-right">${rate}</span>
            <span class="text-slate-400">Total Cases:</span> <span class="font-semibold text-slate-200 text-right">${total}</span>
            <span class="text-slate-400">Deaths:</span> <span class="font-semibold text-rose-400 text-right">${deaths}</span>
          </div>
        </div>
      `);
    } else {
      setTooltipContent(`
        <div class="p-2 text-xs bg-slate-950/90 border border-slate-800 rounded shadow text-slate-400">
          ${geoName} (No live data)
        </div>
      `);
    }
  };

  const handleMouseMove = (event) => {
    // Offset slightly from cursor
    setTooltipPos({
      x: event.clientX + 15,
      y: event.clientY - 20
    });
  };

  const handleMouseLeave = () => {
    setTooltipContent("");
  };

  const handleClick = (geo) => {
    const geoName = geo.properties.name.toLowerCase();
    let country = countryMapByName[geoName];
    if (!country && mapNameOverrides[geoName]) {
      const override = mapNameOverrides[geoName];
      country = countryMapByIso[override.toUpperCase()] || countryMapByName[override];
    }
    if (country && onSelectCountry) {
      onSelectCountry(country.iso_code);
    }
  };

  return (
    <div className="relative w-full h-[400px] bg-slate-950/40 rounded-xl overflow-hidden border border-slate-800/80">
      <ComposableMap 
        projectionConfig={{ scale: 140 }} 
        width={800} 
        height={400}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const geoName = geo.properties.name.toLowerCase();
              let country = countryMapByName[geoName];
              if (!country && mapNameOverrides[geoName]) {
                const override = mapNameOverrides[geoName];
                country = countryMapByIso[override.toUpperCase()] || countryMapByName[override];
              }

              const hasData = !!country;
              const casesPerMil = country?.cases_per_million || 0;

              return (
                <Geography
                  key={geo.rrowKey || geo.id}
                  geography={geo}
                  onMouseEnter={(e) => handleMouseEnter(geo, e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => handleClick(geo)}
                  style={{
                    default: {
                      fill: hasData && casesPerMil > 0 ? colorScale(casesPerMil) : "#1e293b",
                      stroke: "#0f172a",
                      strokeWidth: 0.5,
                      outline: "none",
                      transition: "all 250ms",
                    },
                    hover: {
                      fill: hasData ? "#6366f1" : "#334155",
                      stroke: "#0f172a",
                      strokeWidth: 0.8,
                      outline: "none",
                      cursor: hasData ? "pointer" : "default",
                    },
                    pressed: {
                      fill: "#4f46e5",
                      stroke: "#0f172a",
                      strokeWidth: 1,
                      outline: "none",
                    },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Floating Tooltip */}
      {tooltipContent && (
        <div 
          className="fixed z-50 pointer-events-none transition-transform duration-75 ease-out"
          style={{ 
            left: `${tooltipPos.x}px`, 
            top: `${tooltipPos.y}px` 
          }}
          dangerouslySetInnerHTML={{ __html: tooltipContent }}
        />
      )}

      {/* Map Legend */}
      <div className="absolute bottom-3 left-3 p-3 bg-slate-900/80 border border-slate-800 rounded-lg text-[10px] text-slate-300 backdrop-blur-sm">
        <div className="font-semibold mb-1">Cases Per Million</div>
        <div className="flex items-center gap-2">
          <span>&lt; 1,000</span>
          <div className="w-24 h-2 bg-gradient-to-r from-cyan-700 to-rose-600 rounded"></div>
          <span>&gt; 250,000</span>
        </div>
      </div>
    </div>
  );
};

export default memo(MapChart);
