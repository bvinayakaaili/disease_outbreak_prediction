import sqlite3
import os
import joblib
import pandas as pd
import numpy as np
from scipy.integrate import solve_ivp
from statsmodels.tsa.arima.model import ARIMA

# Define the differential equations for the SEIRD compartmental model
def seird_deriv(t, y, beta_fn, sigma, gamma, mu, N):
    S, E, I, R, D = y
    beta = beta_fn(t)
    
    # Force of infection
    # S and I cannot be negative
    S_val = max(0.0, S)
    I_val = max(0.0, I)
    
    # Avoid dividing by zero if N is 0
    force = (beta * S_val * I_val / N) if N > 0 else 0.0
    
    dSdt = -force
    dEdt = force - sigma * E
    dIdt = sigma * E - (gamma + mu) * I
    dRdt = gamma * I
    dDdt = mu * I
    
    return [dSdt, dEdt, dIdt, dRdt, dDdt]

def run_seird_simulation(population, initial_infected, r0, incubation_period, infectious_period, cfr, t_max, beta_fn=None):
    """
    Runs a standard SEIRD simulation for t_max days.
    """
    I0 = initial_infected
    E0 = 2.0 * initial_infected # Estimate Exposed as twice the initial infected
    R0 = 0.0
    D0 = 0.0
    S0 = population - E0 - I0 - R0 - D0
    
    # Ensure S0 is not negative
    if S0 < 0:
        S0 = 0.0
        population = E0 + I0 + R0 + D0
        
    sigma = 1.0 / max(0.1, incubation_period)
    # Recovery rate gamma + death rate mu = 1 / infectious_period
    gamma = (1.0 - cfr) / max(0.1, infectious_period)
    mu = cfr / max(0.1, infectious_period)
    
    if beta_fn is None:
        # Constant beta based on basic reproduction number
        beta_const = r0 / max(0.1, infectious_period)
        def beta_fn(t): return beta_const
        
    t_span = (0, t_max)
    t_eval = np.linspace(0, t_max, int(t_max) + 1)
    
    sol = solve_ivp(
        seird_deriv, 
        t_span, 
        [S0, E0, I0, R0, D0], 
        args=(beta_fn, sigma, gamma, mu, population), 
        t_eval=t_eval,
        method='RK45'
    )
    
    return {
        't': sol.t.tolist(),
        'S': sol.y[0].tolist(),
        'E': sol.y[1].tolist(),
        'I': sol.y[2].tolist(),
        'R': sol.y[3].tolist(),
        'D': sol.y[4].tolist()
    }

def get_ml_multiplier(model, demographics, grocery_mobility, workplace_mobility, stringency):
    """
    Computes transmission rate multiplier based on interventions relative to baseline.
    demographics: dict containing population_density, median_age, human_development_index, hospital_beds_per_thousand
    """
    pop_density = demographics.get('population_density', 100.0)
    median_age = demographics.get('median_age', 30.0)
    hdi = demographics.get('human_development_index', 0.7)
    beds = demographics.get('hospital_beds_per_thousand', 2.0)
    
    # Feature columns: grocery_mobility_lag14, workplace_mobility_lag14, stringency_index, 
    # population_density, median_age, human_development_index, hospital_beds_per_thousand
    
    baseline_features = [0.0, 0.0, 0.0, pop_density, median_age, hdi, beds]
    active_features = [grocery_mobility, workplace_mobility, stringency, pop_density, median_age, hdi, beds]
    
    try:
        preds = model.predict([baseline_features, active_features])
        r_base = max(0.1, preds[0])
        r_active = max(0.0, preds[1])
        multiplier = r_active / r_base
        # Bound multiplier to prevent unrealistic values
        return float(np.clip(multiplier, 0.05, 5.0))
    except Exception as e:
        print(f"Error computing ML multiplier: {e}")
        return 1.0

import torch
import torch.nn as nn

class LSTMCalibrationModel(nn.Module):
    def __init__(self, input_dim, hidden_dim, num_layers, output_dim=1):
        super(LSTMCalibrationModel, self).__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_dim, hidden_dim, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, output_dim)
        
    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).to(x.device)
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out

def run_historical_backtest(country_code, db_path="outbreaksense.db", model_path="calibration_model.joblib", place=None, model_type="rf"):
    """
    Runs a backtest for the year 2022:
    - Trains/Simulates from 2022-01-01 to 2022-12-31.
    - Compares predicted SEIRD states with actual case/death numbers.
    """
    if not os.path.exists(db_path):
        return {"error": "Database file not found"}
        
    model = None
    if model_type == "rf":
        if not os.path.exists(model_path):
            return {"error": "ML Model file not found"}
        model = joblib.load(model_path)
    elif model_type == "xgboost":
        xgb_path = os.path.join(os.path.dirname(model_path), "xgboost_model.joblib")
        if not os.path.exists(xgb_path):
            return {"error": "XGBoost Model file not found"}
        model = joblib.load(xgb_path)
    elif model_type == "lstm":
        lstm_path = os.path.join(os.path.dirname(model_path), "lstm_model.pt")
        scaler_path = os.path.join(os.path.dirname(model_path), "lstm_scaler.joblib")
        if not os.path.exists(lstm_path) or not os.path.exists(scaler_path):
            return {"error": "LSTM model or scaler files not found"}
        scaler = joblib.load(scaler_path)
        model = LSTMCalibrationModel(7, 32, 1)
        model.load_state_dict(torch.load(lstm_path))
        model.eval()
    
    conn = sqlite3.connect(db_path)
    # Fetch country metadata
    meta = pd.read_sql_query(
        "SELECT * FROM countries_metadata WHERE iso_code = ?", 
        conn, 
        params=(country_code,)
    )
    if meta.empty:
        conn.close()
        return {"error": f"Metadata for country code {country_code} not found"}
        
    meta_row = meta.iloc[0]
    population = meta_row['population']
    demographics = {
        'population_density': meta_row['population_density'],
        'median_age': meta_row['median_age'],
        'human_development_index': meta_row['human_development_index'],
        'hospital_beds_per_thousand': meta_row['hospital_beds_per_thousand']
    }
    
    if place:
        location_data_path = os.path.join(os.path.dirname(__file__), 'subnational_locations.json')
        if os.path.exists(location_data_path):
            import json
            with open(location_data_path, 'r', encoding='utf-8') as fh:
                locations = json.load(fh)
            match = next((loc for loc in locations if loc.get('country_iso') == country_code and str(loc.get('place', '')).lower() == str(place).lower()), None)
            if match:
                population = match.get('population', population)
                demographics.update({
                    'population_density': match.get('population_density', demographics['population_density']),
                    'median_age': match.get('median_age', demographics['median_age']),
                    'human_development_index': match.get('human_development_index', demographics['human_development_index']),
                    'hospital_beds_per_thousand': match.get('hospital_beds_per_thousand', demographics['hospital_beds_per_thousand'])
                })

    # Fetch 2022 daily historical records
    hist = pd.read_sql_query(
        """
        SELECT date, new_cases, new_deaths, total_cases, total_deaths, stringency_index, grocery_mobility, workplace_mobility, reproduction_rate
        FROM historical_data 
        WHERE iso_code = ? AND date >= '2022-01-01' AND date <= '2022-12-31'
        ORDER BY date ASC
        """,
        conn,
        params=(country_code,)
    )
    
    # Also fetch lookback cases from late 2021 to initialize I0 and E0
    lookback = pd.read_sql_query(
        """
        SELECT new_cases, total_cases, total_deaths
        FROM historical_data 
        WHERE iso_code = ? AND date >= '2021-12-20' AND date <= '2021-12-31'
        ORDER BY date ASC
        """,
        conn,
        params=(country_code,)
    )
    
    conn.close()
    
    if hist.empty:
        return {"error": f"No historical data for {country_code} in 2022"}
        
    # Date arrays
    dates = hist['date'].tolist()
    n_days = len(dates)
    
    # Initialize SEIRD compartments on Jan 1, 2022
    actual_start_deaths = hist.iloc[0]['total_deaths'] if not pd.isna(hist.iloc[0]['total_deaths']) else 0.0
    actual_start_cases = hist.iloc[0]['total_cases'] if not pd.isna(hist.iloc[0]['total_cases']) else 0.0
    
    # Estimate active cases I0 as the sum of new cases in the last 10 days of 2021
    if not lookback.empty:
        new_cases_end_2021 = lookback['new_cases'].sum()
        I0 = float(max(10.0, new_cases_end_2021))
    else:
        I0 = float(max(10.0, actual_start_cases * 0.05)) # Fallback: 5% of cases
        
    # Estimate exposed E0 as the new cases in the next 5 days of 2022
    E0 = float(hist.iloc[0:5]['new_cases'].sum())
    if pd.isna(E0) or E0 <= 0:
        E0 = I0 * 1.5
        
    D0 = float(actual_start_deaths)
    R0 = float(max(0.0, actual_start_cases - I0 - D0))
    S0 = float(max(0.0, population - E0 - I0 - R0 - D0))
    
    # Pre-calculate beta for each day in 2022 using the ML model
    # We will use 14-day lagged mobility already stored in the DB, or compute it.
    # To be safe, we look up the historical values and shift them or use them as stored.
    # Since historical_data table contains grocery_mobility and workplace_mobility:
    # We will compute the 14-day lag manually for this slice or use the pre-stored lag.
    # Wait, the historical_data table contains raw mobility. Let's retrieve all records
    # including 14 days before 2022 to get the lag correctly.
    # Let's write a lookup function for daily beta:
    
    # For speed and simplicity, we can query the lags we computed in data_pipeline.
    # Oh, wait! In data_pipeline.py, we only stored raw grocery_mobility and workplace_mobility in historical_data.
    # Let's check: yes, we did! In STEP 6, we saved raw `grocery_mobility` and `workplace_mobility`.
    # So we need to calculate the 14-day lag here.
    # Let's retrieve mobility data starting from '2021-12-18' (14 days before 2022-01-01) to compute lags.
    conn = sqlite3.connect(db_path)
    mobility_slice = pd.read_sql_query(
        """
        SELECT date, grocery_mobility, workplace_mobility, stringency_index
        FROM historical_data 
        WHERE iso_code = ? AND date >= '2021-12-15' AND date <= '2022-12-31'
        ORDER BY date ASC
        """,
        conn,
        params=(country_code,)
    )
    conn.close()
    
    # Sort and set index
    mobility_slice = mobility_slice.sort_values(by='date').reset_index(drop=True)
    # Shift mobility by 14 days
    mobility_slice['grocery_lag14'] = mobility_slice['grocery_mobility'].shift(14).fillna(0.0)
    mobility_slice['workplace_lag14'] = mobility_slice['workplace_mobility'].shift(14).fillna(0.0)
    
    # Filter back to 2022
    mobility_2022 = mobility_slice[
        (mobility_slice['date'] >= '2022-01-01') & (mobility_slice['date'] <= '2022-12-31')
    ].copy().reset_index(drop=True)
    
    # If the lengths don't match, align them
    # For safety, let's merge mobility_2022 into hist
    hist_merged = pd.merge(
        hist[['date', 'new_cases', 'new_deaths', 'total_cases', 'total_deaths', 'reproduction_rate']], 
        mobility_2022[['date', 'grocery_lag14', 'workplace_lag14', 'stringency_index']], 
        on='date', 
        how='left'
    ).fillna(0.0)
    
    if model_type == "arima":
        # Get historical training reproduction rate series before 2022-01-01
        conn = sqlite3.connect(db_path)
        train_series_df = pd.read_sql_query(
            """
            SELECT date, reproduction_rate
            FROM historical_data 
            WHERE iso_code = ? AND date < '2022-01-01' AND date >= '2020-02-01'
            ORDER BY date ASC
            """,
            conn,
            params=(country_code,)
        )
        conn.close()
        
        train_series_df['reproduction_rate'] = train_series_df['reproduction_rate'].ffill().bfill()
        train_series = train_series_df['reproduction_rate'].dropna().values
        
        # Fit ARIMA and forecast n_days into 2022
        if len(train_series) > 10:
            try:
                arima_model = ARIMA(train_series, order=(1, 1, 1))
                fit_res = arima_model.fit()
                predicted_r = fit_res.forecast(steps=n_days)
                # Clip values to be reasonable (e.g. between 0.01 and 10.0)
                predicted_r = np.clip(predicted_r, 0.01, 10.0)
            except Exception as e:
                print(f"ARIMA fit/forecast failed: {e}. Falling back to default baseline.")
                predicted_r = [1.0] * n_days
        else:
            predicted_r = [1.0] * n_days
    elif model_type == "lstm":
        # Predict R_t for each day in 2022 using PyTorch LSTM sliding window
        pop_density = demographics['population_density']
        median_age = demographics['median_age']
        hdi = demographics['human_development_index']
        beds = demographics['hospital_beds_per_thousand']
        
        features_list_full = []
        dates_full = mobility_slice['date'].tolist()
        for idx, row in mobility_slice.iterrows():
            features_list_full.append([
                row['grocery_lag14'],
                row['workplace_lag14'],
                row['stringency_index'],
                pop_density,
                median_age,
                hdi,
                beds
            ])
            
        full_df = pd.DataFrame(features_list_full, columns=[
            'grocery_mobility_lag14',
            'workplace_mobility_lag14',
            'stringency_index',
            'population_density',
            'median_age',
            'human_development_index',
            'hospital_beds_per_thousand'
        ])
        full_df['date'] = dates_full
        
        predicted_r = []
        for t_date in dates:
            # Find index in full_df
            idx = full_df[full_df['date'] == t_date].index[0]
            # Get sequence of 14 days ending at idx
            seq_df = full_df.iloc[idx - 13 : idx + 1].drop(columns=['date'])
            # Scale features
            seq_scaled = scaler.transform(seq_df)
            # Reshape to [1, 14, 7]
            seq_tensor = torch.tensor(seq_scaled, dtype=torch.float32).unsqueeze(0)
            
            with torch.no_grad():
                pred = model(seq_tensor).item()
            predicted_r.append(pred)
            
        # Clip values to be reasonable (e.g. between 0.01 and 10.0)
        predicted_r = np.clip(predicted_r, 0.01, 10.0)
    else:
        # Predict R_t for each day in 2022 using Random Forest or XGBoost
        # Features: grocery_mobility_lag14, workplace_mobility_lag14, stringency_index, 
        # population_density, median_age, human_development_index, hospital_beds_per_thousand
        pop_density = demographics['population_density']
        median_age = demographics['median_age']
        hdi = demographics['human_development_index']
        beds = demographics['hospital_beds_per_thousand']
        
        features_list = []
        for idx, row in hist_merged.iterrows():
            features_list.append([
                row['grocery_lag14'],
                row['workplace_lag14'],
                row['stringency_index'],
                pop_density,
                median_age,
                hdi,
                beds
            ])
            
        features_df = pd.DataFrame(features_list, columns=[
            'grocery_mobility_lag14',
            'workplace_mobility_lag14',
            'stringency_index',
            'population_density',
            'median_age',
            'human_development_index',
            'hospital_beds_per_thousand'
        ])
        predicted_r = model.predict(features_df)
    
    # Infectious period for COVID is ~7 days, incubation ~5 days, CFR estimated from historical data
    # Let's estimate CFR for 2022 from historical data (total deaths in 2022 / total cases in 2022)
    cases_2022 = max(1.0, hist_merged['new_cases'].sum())
    deaths_2022 = hist_merged['new_deaths'].sum()
    cfr_2022 = float(np.clip(deaths_2022 / cases_2022, 0.001, 0.05)) # Bind between 0.1% and 5%
    
    incubation_period = 5.0
    infectious_period = 7.0
    
    sigma = 1.0 / incubation_period
    gamma = (1.0 - cfr_2022) / infectious_period
    mu = cfr_2022 / infectious_period
    
    # Map day index to predicted beta
    # beta(t) = R_t / infectious_period
    daily_betas = [max(0.01, r / infectious_period) for r in predicted_r]
    
    def beta_fn(t):
        idx = int(np.clip(t, 0, len(daily_betas) - 1))
        return daily_betas[idx]
        
    # Solve ODE
    t_span = (0, n_days - 1)
    t_eval = np.arange(n_days)
    
    sol = solve_ivp(
        seird_deriv, 
        t_span, 
        [S0, E0, I0, R0, D0], 
        args=(beta_fn, sigma, gamma, mu, population), 
        t_eval=t_eval,
        method='RK45'
    )
    
    # Extract results
    S_sim = sol.y[0]
    E_sim = sol.y[1]
    I_sim = sol.y[2]
    R_sim = sol.y[3]
    D_sim = sol.y[4]
    
    # Calculate simulated cumulative cases (total cases = N - S)
    # Actually, cumulative cases = E + I + R + D
    # Wait, cumulative cases = population - S
    cases_sim = population - S_sim
    
    # Format return data
    return {
        'dates': dates,
        'simulated': {
            'cases': cases_sim.tolist(),
            'deaths': D_sim.tolist(),
            'infectious': I_sim.tolist(),
            'recovered': R_sim.tolist(),
            'exposed': E_sim.tolist()
        },
        'actual': {
            'cases': hist_merged['total_cases'].tolist(),
            'deaths': hist_merged['total_deaths'].tolist(),
            'new_cases': hist_merged['new_cases'].tolist(),
            'new_deaths': hist_merged['new_deaths'].tolist()
        },
        'metrics': {
            'cfr': cfr_2022,
            'infectious_period': infectious_period,
            'incubation_period': incubation_period,
            'initial_cases': actual_start_cases,
            'initial_deaths': actual_start_deaths
        }
    }
