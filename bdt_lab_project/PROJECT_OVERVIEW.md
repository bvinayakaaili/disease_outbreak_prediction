# OutbreakSense Project Overview

## 1. Introduction

OutbreakSense is a disease-agnostic outbreak simulation and prediction platform designed to combine epidemiological modeling, machine learning calibration, and real-time dashboards. The project is built to help users understand how infectious diseases spread, how interventions affect transmission, and how public health conditions influence outbreak risk.

The platform brings together three core capabilities:

- historical outbreak backtesting,
- live COVID-19 monitoring,
- interactive simulation of future disease scenarios.

The overall goal is to provide an accessible, data-driven environment for studying outbreak dynamics without requiring advanced programming or deep epidemiological expertise.

---

## 2. Problem Statement

Traditional epidemic models are useful, but they often struggle to reflect changing real-world behavior such as:

- changes in mobility,
- government interventions,
- population vulnerability,
- pathogen-specific differences.

This project addresses that gap by combining a classical compartmental model with a machine learning layer that adjusts transmission dynamics using real-world indicators such as mobility, stringency, and demographic vulnerability.

---

## 3. Project Objectives

The main objectives of OutbreakSense are to:

1. simulate outbreak trajectories under different assumptions,
2. compare model predictions against actual historical data,
3. monitor live epidemiological conditions,
4. evaluate the impact of interventions such as lockdowns and mobility reductions,
5. support explainability through vulnerability and calibration insights.

---

## 4. System Architecture

The project is divided into three main layers:

### 4.1 Backend

The backend is implemented in Python using FastAPI. It provides API endpoints for:

- country metadata,
- historical data retrieval,
- backtesting results,
- live summary data,
- simulation execution.

### 4.2 Frontend

The frontend is implemented in React with Vite and Tailwind CSS. It provides an interactive dashboard with:

- live monitoring views,
- historical backtesting charts,
- simulation controls,
- explainability panels.

### 4.3 Data Layer

The application uses SQLite for local storage and now integrates Apache Spark for scalable preprocessing of large epidemiological and mobility datasets. The data pipeline loads COVID-19, mobility, stringency, and demographic sources, performs joins and lag-based feature engineering in Spark, and converts to pandas only at the training boundary for the machine learning model.

The data layer includes:

- COVID-19 case and death data,
- mobility indicators,
- policy stringency indicators,
- demographic metadata,
- Spark-based preprocessing for large-scale feature engineering.

---

## 5. Methodology

### 5.1 SEIRD Epidemiological Model

The simulation engine is based on the SEIRD model:

- Susceptible
- Exposed
- Infectious
- Recovered
- Deceased

The model uses differential equations to describe how individuals move between compartments over time.

Key parameters include:

- transmission rate,
- incubation period,
- infectious period,
- case fatality rate (CFR).

### 5.2 ML-Based Calibration

To make the model more realistic, the project uses a machine learning calibration layer. The model learns relationships between observed transmission behavior and variables such as:

- mobility changes,
- government stringency,
- population density,
- median age,
- human development index,
- hospital beds per thousand.

The preprocessing stage now runs through Apache Spark to handle large-scale joins, aggregations, and 14-day lag feature generation efficiently. The resulting feature matrix is then used to train the Random Forest regressor that provides the transmission multiplier under different intervention and demographic conditions.

### 5.3 Historical Backtesting

The historical backtest mode compares the model’s simulated trajectories against actual 2022 data for selected countries. This allows users to evaluate how well the calibrated model captures real-world outbreak patterns.

### 5.4 Live Monitoring

The live dashboard fetches current COVID-19 information and displays:

- global case trends,
- country-specific risk indicators,
- data freshness and delay warnings.

### 5.5 Simulation Lab

The Simulation Lab allows users to adjust disease parameters and intervention conditions to explore how outbreaks evolve under scenarios such as:

- higher or lower transmissibility,
- different fatality rates,
- mobility restrictions,
- public health interventions.

---

## 6. Data Sources

The project uses a combination of public and processed datasets, including:

- WHO/OWID-style COVID statistics,
- Google Mobility data,
- stringency policy data,
- demographic metadata for countries.

The system also includes support for subnational place-based modeling, allowing users to apply place-specific demographic assumptions for supported regions or cities.

---

## 7. Tools and Technologies

### 7.1 Programming Languages

- Python
- JavaScript
- JSX / React

### 7.2 Backend Tools

- FastAPI
- Uvicorn
- SQLite
- Pandas
- NumPy
- SciPy
- joblib
- requests
- PySpark
- Java Runtime for Spark execution

### 7.3 Frontend Tools

- React
- Vite
- Tailwind CSS
- Recharts
- Lucide Icons

### 7.4 Development and Execution

- Windows batch launcher for one-click startup
- npm for frontend dependency management
- Python environment for backend execution
- Spark-enabled Python environment for preprocessing and model generation

---

## 8. Results and Current Capabilities

The current implementation provides a functional end-to-end outbreak modeling platform with the following capabilities:

- interactive outbreak simulation with configurable disease parameters,
- historical comparison of simulated vs actual outcomes,
- live outbreak dashboard with country-level indicators,
- explainability and vulnerability-based insights,
- subnational place-aware modeling for supported locations,
- a responsive web interface for exploration and analysis,
- a verified Apache Spark preprocessing pipeline that builds the calibration model and SQLite database artifacts end to end.

These results demonstrate that the platform can effectively connect epidemiological theory, data-driven calibration, interactive visualization, and scalable big-data preprocessing into a practical application.

---

## 9. Key Takeaways

OutbreakSense shows how classical epidemiological models can be enhanced with modern data science techniques. The combination of SEIRD modeling, machine learning calibration, and interactive visualization creates a flexible platform for outbreak analysis and public health scenario exploration.

The project is particularly useful for:

- educational demonstrations,
- scenario testing,
- exploratory risk analysis,
- comparing intervention strategies.

---

## 10. Future Enhancements

Possible future extensions include:

- richer subnational datasets,
- more advanced calibration models,
- real-time forecasting dashboards,
- more explainability features,
- integration with additional public health data sources,
- deployment of the Spark pipeline on a distributed cluster for larger-scale processing.
