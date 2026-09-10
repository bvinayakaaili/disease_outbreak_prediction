# OutbreakSense — Epidemiological Prediction and Simulation Platform

OutbreakSense is a general-purpose, disease-agnostic outbreak simulation and prediction platform coupled with a live real-time COVID-19 monitoring dashboard. It combines traditional compartmental epidemiological ODE modeling (SEIRD) with a machine learning calibration layer trained on historical Google Mobility and OWID COVID-19 records.

---

## 1. Core Architecture

### 1.1 The Mathematical SEIRD Model

The simulation engine uses a Compartmental SEIRD (Susceptible-Exposed-Infectious-Recovered-Deceased) compartmental model:

$$\frac{dS}{dt} = -\beta(t) \frac{S \cdot I}{N}$$
$$\frac{dE}{dt} = \beta(t) \frac{S \cdot I}{N} - \sigma E$$
$$\frac{dI}{dt} = \sigma E - (\gamma + \mu) I$$
$$\frac{dR}{dt} = \gamma I$$
$$\frac{dD}{dt} = \mu I$$

Where:

- $N = S + E + I + R + D$ is the constant population size.
- $\sigma = 1 / T_{\text{inc}}$ is the rate of transition from Exposed to Infectious ($T_{\text{inc}}$ = incubation period).
- $\gamma = (1 - \text{CFR}) / T_{\text{inf}}$ is the recovery rate ($T_{\text{inf}}$ = infectious period, $\text{CFR}$ = Case Fatality Rate).
- $\mu = \text{CFR} / T_{\text{inf}}$ is the disease-induced death rate.
- $\beta(t)$ is the dynamic, time-varying transmission rate.

### 1.2 Machine Learning & Deep Learning Calibration Layers

The transmission rate is calculated as:
$$\beta(t) = \frac{R_t}{T_{\text{inf}}}$$

To predict $R_t$ dynamically, we support four distinct calibration models:

1. **Random Forest Regressor** (Default Calibration):
   * Trained on the OWID and Google Mobility datasets using 7 key features.
2. **XGBoost Regressor** (Gradient Boosting):
   * Provides high-accuracy out-of-sample predictions with superior generalization in regions like the US and Germany.
3. **LSTM Sequence Model** (Deep Learning):
   * A PyTorch recurrent neural network trained on 14-day sliding sequences of country features to capture temporal progression.
4. **ARIMA (1,1,1)** (Univariate Time Series):
   * Extrapolates $R_t$ based strictly on historical trends without policy/mobility covariates.

- **Features Used**:
  - `grocery_mobility_lag14`: Grocery/pharmacy mobility change, shifted by 14 days.
  - `workplace_mobility_lag14`: Workplace mobility change, shifted by 14 days.
  - `stringency_index`: Government response containment index (0 to 100).
  - Country-specific demographics: Population density, median population age, human development index (HDI), and hospital beds per thousand.

- **Model Comparison ($R^2$ Score on 2022 Test Split)**:
  
  | Country | Random Forest | XGBoost | LSTM | ARIMA (1,1,1) |
  | :--- | :---: | :---: | :---: | :---: |
  | **India (IND)** | **`68.27%`** | `37.09%` | `9.96%` | `-1304.56%` |
  | **United States (USA)** | `7.44%` | **`23.29%`** | `-9.29%` | `-588.82%` |
  | **Germany (DEU)** | `27.06%` | **`27.85%`** | `12.59%` | `-355.83%` |

- **Disease-Agnostic Multiplier**:
  To simulate hypothetical pathogens (like Measles or Flu), we extract a relative multiplier:
  $$\text{Multiplier}(t) = \frac{f(\text{Mobility}(t-14), \text{Stringency}(t), \text{Demographics})}{f(\text{Baseline Mobility=0}, \text{Baseline Stringency=0}, \text{Demographics})}$$
  This multiplier scales the user's base disease $R_0$, allowing the model to adapt COVID-19 policy and mobility learnings to any novel pathogen.

### 1.3 Outbreak Vulnerability Index (OVI)

We precompute a composite **Outbreak Vulnerability Index (OVI)** for each country:
$$\text{OVI} = 0.4 \cdot S_{\text{age}} + 0.3 \cdot S_{\text{beds\_inverted}} + 0.3 \cdot S_{\text{hdi\_inverted}}$$
where indicators are min-max normalized across all global countries. High OVI indicates an older population, fewer hospital beds, and lower socioeconomic HDI capacity, putting the country at higher epidemic risk.

---

## 2. Operating Modes

### A) Historical Mode

Allows backtesting the model on 2022 historical timelines. The SEIRD ODE is initialized using actual late 2021 cases/deaths and simulated forward, driven day-by-day by the country's actual 2022 mobility/stringency values via the ML model, and compared directly to actual 2022 curves. An annotated wave explorer lets users study delta and omicron waves.

### B) Live Mode

Real-time dashboard polling `disease.sh` every 20 minutes. It:

- Stores polls in SQLite (`live_polls` table) to build a long-term time series.
- Seeds the database on first startup with a 30-day lookback using the historical endpoint.
- Dynamically computes risk badges (rising/stable/declining) by comparing the latest 7-day case sum to the preceding 7-day sum (growth threshold: $\pm 8\%$).
- Handles downtime gracefully by caching results and raising a delay warning banner in the UI.
- **Reporting Caveat**: Global COVID reporting is far less frequent than in 2020-2022. Curves appear flatter; the UI explicitly notes this data-quality limit.

### C) Simulation Mode

Integrates the SEIRD ODE solver with pathogen presets and active sliders. Users can model lockdowns (start day, duration, stringency) and slide mobility changes to see how the outbreak peak shifts.

---

## 3. How to Add a New Disease Preset

Pathogen presets are defined in the frontend component `frontend/src/components/SimulationLab.jsx` in the `DISEASE_PRESETS` dictionary.

To add a new pathogen preset:

1. Open the file [SimulationLab.jsx](file:///c:/Users/ashis/Desktop/bdt_lab_project/frontend/src/components/SimulationLab.jsx).
2. Locate the `DISEASE_PRESETS` object around line 5.
3. Append your new preset. For example, to add **Ebola**:
   ```javascript
   ebola: {
     name: "Ebola Virus Disease",
     r0: 1.8,
     incubation: 11.0,
     infectious: 10.0,
     cfr: 0.50, // 50% case fatality rate
   }
   ```
4. Save the file. The preset will automatically appear in the drop-down selector in the Simulation Lab tab.

---

## 4. Local Quick Start

### Option A: One-click Windows batch launcher

Run the batch file from the project root:

```bat
start_app.bat
```

This will open two terminals and start:

- the FastAPI backend at http://127.0.0.1:8000
- the Vite frontend at http://localhost:5173

### Option B: Start manually

1. **Backend Server**:
   Launch the FastAPI API using Uvicorn:

   ```bash
   python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
   ```

2. **Frontend Development Server**:
   Start Vite's dev server:
   ```bash
   cd frontend
   npm install
   npm run dev -- --host localhost --port 5173
   ```
   Navigate to `http://localhost:5173`.

### Troubleshooting

- If the backend fails to start, make sure Python and the required packages are installed.
- If the frontend fails to start, run `npm install` inside the frontend folder first..
