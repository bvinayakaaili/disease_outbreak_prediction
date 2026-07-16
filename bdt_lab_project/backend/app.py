from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import sqlite3
import joblib
import pandas as pd

# Import our custom modules
from backend.seir import run_seird_simulation, run_historical_backtest, get_ml_multiplier
from backend.db import get_countries, get_historical_country_data, get_explainability_data, get_subnational_locations
from backend.scheduler import start_scheduler, LIVE_CACHE

DB_PATH = "outbreaksense.db"
MODEL_PATH = "calibration_model.joblib"
EXPLAIN_PATH = "explainability.json"

app = FastAPI(title="OutbreakSense API", description="Disease-Agnostic Prediction and Simulation Platform API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup event to start background live polls
@app.on_event("startup")
def startup_event():
    # Only start scheduler if we are not running a simple CLI tool / check
    # Start scheduler thread
    app.state.scheduler = start_scheduler()

@app.on_event("shutdown")
def shutdown_event():
    # Shutdown scheduler
    if hasattr(app.state, "scheduler"):
        app.state.scheduler.shutdown()

# Data models for simulation request
class InterventionParam(BaseModel):
    start_day: int
    duration: int
    grocery_mobility: float  # percent change e.g. -40.0
    workplace_mobility: float  # percent change e.g. -35.0
    stringency: float  # government stringency index 0-100

class SimulationRequest(BaseModel):
    population: float
    initial_infected: float
    r0: float
    incubation_period: float
    infectious_period: float
    cfr: float
    t_max: int
    iso_code: Optional[str] = None
    place: Optional[str] = None
    use_ml_multiplier: bool = False
    vulnerability_multiplier: float = 1.0  # multiplier on transmission rate
    intervention: Optional[InterventionParam] = None

# --- API ROUTES ---

@app.get("/api/countries")
def api_get_countries():
    """
    Returns list of all countries with their demographics and vulnerability indexes.
    """
    countries = get_countries(DB_PATH)
    if not countries:
        raise HTTPException(status_code=500, detail="Database not seeded or country metadata missing")
    return countries

@app.get("/api/places")
def api_get_places(country: Optional[str] = None):
    """
    Returns available subnational places for a country, if any are configured.
    """
    locations = get_subnational_locations(country)
    return locations

@app.get("/api/historical/data")
def api_get_historical_data(country: str):
    """
    Returns daily historical COVID-19 and mobility records for a country.
    """
    data = get_historical_country_data(country, DB_PATH)
    if not data:
        raise HTTPException(status_code=404, detail=f"No historical data found for country {country}")
    return data

@app.get("/api/historical/waves")
def api_get_historical_waves():
    """
    Returns preset annotations for major historical COVID-19 outbreak waves.
    """
    return [
        {
            "id": "india_delta",
            "country_code": "IND",
            "country_name": "India",
            "wave_name": "Delta Wave",
            "start_date": "2021-03-01",
            "end_date": "2021-07-31",
            "peak_date": "2021-05-08",
            "peak_cases": 401078,  # Peak daily new cases (smoothed peak)
            "description": "The devastating Delta variant wave in India in Spring 2021. Daily new cases peaked in early May at over 400,000 cases with intense hospital and supply shortages, showing extreme vulnerability due to low ICU capacity per thousand."
        },
        {
            "id": "us_winter_2020",
            "country_code": "USA",
            "country_name": "United States",
            "wave_name": "Winter Wave",
            "start_date": "2020-11-01",
            "end_date": "2021-03-01",
            "peak_date": "2021-01-08",
            "peak_cases": 300000,
            "description": "The first massive winter wave in the US, driven by cold weather and holiday gatherings. Daily cases peaked at nearly 300,000 daily, testing hospital system limits before vaccines became widely available."
        },
        {
            "id": "sa_omicron",
            "country_code": "ZAF",
            "country_name": "South Africa",
            "wave_name": "Omicron Debut Wave",
            "start_date": "2021-11-15",
            "end_date": "2022-01-15",
            "peak_date": "2021-12-15",
            "peak_cases": 26976,
            "description": "The global debut of the hyper-transmissible Omicron variant. South Africa experienced a extremely sharp rise in cases peaking in mid-December, but saw a significantly lower case-fatality rate than the preceding Delta wave."
        }
    ]

@app.get("/api/historical/backtest")
def api_get_backtest(country: str, place: Optional[str] = None, model_type: str = "rf"):
    """
    Runs a 2022 backtest for a country or configured subnational place: actual vs. ML/ARIMA-calibrated SEIRD simulation.
    """
    results = run_historical_backtest(country, DB_PATH, MODEL_PATH, place=place, model_type=model_type)
    if "error" in results:
        raise HTTPException(status_code=404, detail=results["error"])
    return results

@app.get("/api/live/summary")
def api_get_live_summary():
    """
    Returns latest global live summary data.
    """
    if not LIVE_CACHE["global"]:
        # If API is down or cache is empty
        raise HTTPException(status_code=503, detail="Live data not cached yet. Try again shortly.")
    return {
        "global": LIVE_CACHE["global"],
        "last_updated": LIVE_CACHE["last_updated"],
        "is_delayed": LIVE_CACHE["is_delayed"]
    }

@app.get("/api/live/countries")
def api_get_live_countries():
    """
    Returns per-country current stats, computed risk badges, and 14-day case trends.
    """
    if not LIVE_CACHE["countries"]:
        raise HTTPException(status_code=503, detail="Live data not cached yet.")
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # We will fetch last 14 days of cases from live_polls for each country to calculate trend
    cursor.execute("""
        SELECT iso_code, date, cases, today_cases
        FROM live_polls
        WHERE date >= date('now', '-16 days')
        ORDER BY iso_code, date ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    # Group trends by country
    country_trends = {}
    for r in rows:
        iso = r[0]
        cases_val = r[2]
        today_val = r[3]
        if iso not in country_trends:
            country_trends[iso] = []
        country_trends[iso].append({"cases": cases_val, "today": today_val})
        
    enriched_countries = []
    
    # Fetch country vulnerability metadata
    countries_meta = get_countries(DB_PATH)
    meta_dict = {c['iso_code']: c for c in countries_meta}
    
    for c in LIVE_CACHE["countries"]:
        iso = c["iso_code"]
        meta_info = meta_dict.get(iso, {})
        
        # Calculate risk badge (rising, stable, declining)
        trend = country_trends.get(iso, [])
        badge = "stable"
        sparkline = []
        
        # If we have daily records, compute sparkline and trajectory
        if len(trend) >= 7:
            # Sparkline points = daily new cases
            sparkline = [day.get("today", 0) for day in trend][-14:]
            
            # Divide into recent week (last 7 days) and prior week
            recent_week = sparkline[-7:]
            prior_week = sparkline[-14:-7] if len(sparkline) >= 14 else sparkline[0:min(7, len(sparkline)-7)]
            
            sum_recent = sum(recent_week)
            sum_prior = sum(prior_week)
            
            # Growth rate
            growth = (sum_recent - sum_prior) / (sum_prior + 1.0)
            
            if sum_recent > 20: # Noise floor
                if growth > 0.08:
                    badge = "rising"
                elif growth < -0.08:
                    badge = "declining"
                    
        # If trend is unavailable, fallback on todayCases
        elif c["today_cases"] > 100:
            badge = "rising"
            sparkline = [c["today_cases"]]
            
        enriched_countries.append({
            **c,
            "vulnerability_index": meta_info.get("vulnerability_index", 0.5),
            "median_age": meta_info.get("median_age", 30.0),
            "hospital_beds_per_thousand": meta_info.get("hospital_beds_per_thousand", 2.0),
            "human_development_index": meta_info.get("human_development_index", 0.7),
            "population_density": meta_info.get("population_density", 100.0),
            "risk_badge": badge,
            "sparkline": sparkline
        })
        
    return {
        "countries": enriched_countries,
        "last_updated": LIVE_CACHE["last_updated"],
        "is_delayed": LIVE_CACHE["is_delayed"]
    }

@app.get("/api/live/country/{iso_code}")
def api_get_live_country_history(iso_code: str):
    """
    Returns daily live history from SQLite for a single country.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT date, cases, deaths, recovered, today_cases, today_deaths, today_recovered
        FROM live_polls
        WHERE iso_code = ?
        ORDER BY date ASC
    """, (iso_code,))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        raise HTTPException(status_code=404, detail=f"No live history found for {iso_code}")
        
    return [
        {
            "date": r[0],
            "cases": r[1],
            "deaths": r[2],
            "recovered": r[3],
            "today_cases": r[4],
            "today_deaths": r[5],
            "today_recovered": r[6]
        }
        for r in rows
    ]

@app.post("/api/simulation/run")
def api_run_simulation(req: SimulationRequest):
    """
    Runs the compartmental SEIRD simulation based on user parameters,
    optionally modulated by ML calibration and country demographics.
    """
    model = None
    demographics = None
    
    if req.use_ml_multiplier:
        if not os.path.exists(MODEL_PATH):
            raise HTTPException(status_code=500, detail="ML calibration model not found")
        model = joblib.load(MODEL_PATH)
        
        if req.iso_code:
            # Look up actual country demographics or a configured subnational place override
            conn = sqlite3.connect(DB_PATH)
            meta = pd.read_sql_query(
                "SELECT * FROM countries_metadata WHERE iso_code = ?", 
                conn, 
                params=(req.iso_code,)
            )
            conn.close()
            if not meta.empty:
                meta_row = meta.iloc[0]
                demographics = {
                    'population_density': meta_row['population_density'],
                    'median_age': meta_row['median_age'],
                    'human_development_index': meta_row['human_development_index'],
                    'hospital_beds_per_thousand': meta_row['hospital_beds_per_thousand']
                }

                place_override = None
                if req.place:
                    place_override = next((p for p in get_subnational_locations(req.iso_code) if p.get('place', '').lower() == req.place.lower()), None)
                    if place_override:
                        demographics.update({
                            'population_density': place_override.get('population_density', demographics['population_density']),
                            'median_age': place_override.get('median_age', demographics['median_age']),
                            'human_development_index': place_override.get('human_development_index', demographics['human_development_index']),
                            'hospital_beds_per_thousand': place_override.get('hospital_beds_per_thousand', demographics['hospital_beds_per_thousand'])
                        })
                
        # If no country provided or not found, fall back to global medians
        if not demographics:
            demographics = {
                'population_density': 100.0,
                'median_age': 30.0,
                'human_development_index': 0.7,
                'hospital_beds_per_thousand': 2.0
            }
            
    # Compile the transmission function beta(t)
    # The default beta is R0 / infectious_period
    default_beta = req.r0 / req.infectious_period
    
    def beta_fn(t):
        # Default baseline
        val = default_beta
        
        # Check if intervention is active at time t
        if req.intervention:
            start = req.intervention.start_day
            end = start + req.intervention.duration
            if start <= t <= end:
                if req.use_ml_multiplier and model and demographics:
                    # Run features through ML model to get multiplier
                    mult = get_ml_multiplier(
                        model, demographics, 
                        req.intervention.grocery_mobility, 
                        req.intervention.workplace_mobility, 
                        req.intervention.stringency
                    )
                    # Apply vulnerability multiplier
                    val = default_beta * mult * req.vulnerability_multiplier
                else:
                    # Simple linear mobility stringency intervention effect fallback
                    # e.g., stringency reduces transmission by up to 50%
                    factor = 1.0 - (req.intervention.stringency / 200.0)
                    # mobility reduces transmission: -30% mobility -> 0.7 multiplier
                    mob_avg = (req.intervention.grocery_mobility + req.intervention.workplace_mobility) / 2.0
                    mob_factor = 1.0 + (mob_avg / 100.0) # since mob_avg is negative, this reduces factor
                    val = default_beta * factor * mob_factor * req.vulnerability_multiplier
            else:
                # Outside intervention window, apply natural vulnerability modifier
                val = default_beta * req.vulnerability_multiplier
        else:
            # No intervention, apply vulnerability modifier
            val = default_beta * req.vulnerability_multiplier
            
        return max(0.001, val)
        
    # Solve ODE
    try:
        curves = run_seird_simulation(
            population=req.population,
            initial_infected=req.initial_infected,
            r0=req.r0,
            incubation_period=req.incubation_period,
            infectious_period=req.infectious_period,
            cfr=req.cfr,
            t_max=req.t_max,
            beta_fn=beta_fn
        )
        
        # Add peak statistics
        # Peak of active infectious cases I
        i_curve = curves['I']
        peak_idx = i_curve.index(max(i_curve))
        curves['peak_day'] = peak_idx
        curves['peak_infections'] = max(i_curve)
        curves['total_deaths'] = curves['D'][-1]
        curves['total_cases'] = req.population - curves['S'][-1]
        
        return curves
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation failed: {e}")

@app.get("/api/explainability")
def api_get_explainability():
    """
    Returns ML calibration layer model parameters, importances, and backtest R2 scores.
    """
    return get_explainability_data(EXPLAIN_PATH)

# Mount frontend production build directory if exists, otherwise display message.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_path = os.path.join(BASE_DIR, "frontend", "dist")

if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")
else:
    @app.get("/")
    def read_root():
        return {"message": "Welcome to OutbreakSense API. Frontend static files are not built yet. Run Vite server for development."}
