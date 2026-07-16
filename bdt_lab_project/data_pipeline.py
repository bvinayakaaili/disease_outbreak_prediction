import os
import glob
import sqlite3
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score
import joblib

from backend.bigdata.pyspark_pipeline import build_spark_session, load_and_preprocess_data


def preprocess_and_build():
    project_root = Path(__file__).resolve().parent
    db_path = project_root / "outbreaksense.db"
    model_path = project_root / "calibration_model.joblib"
    explain_path = project_root / "explainability.json"

    print("--- STEP 1: Loading and preprocessing datasets with Apache Spark ---")
    spark = build_spark_session()
    try:
        preprocessed = load_and_preprocess_data(project_root=project_root, spark=spark)
        merged = preprocessed["merged_df"].toPandas()
        demographics = preprocessed["demographics_df"].toPandas()
    finally:
        spark.stop()

    merged = merged.copy()
    merged['date'] = pd.to_datetime(merged['date'])
    merged = merged.sort_values(by=['iso_code', 'date']).reset_index(drop=True)

    print(f"OWID raw records for countries: {len(merged)}")
    print(f"Precomputed OVI for {len(demographics)} countries.")
    print(demographics[['location', 'vulnerability_index']].sort_values(by='vulnerability_index', ascending=False).head(5))

    print("\n--- STEP 2: Training ML Calibration Model ---")
    ml_cols = [
        'reproduction_rate', 'grocery_mobility_lag14', 'workplace_mobility_lag14',
        'stringency_index', 'population_density', 'median_age',
        'human_development_index', 'hospital_beds_per_thousand', 'date', 'iso_code'
    ]

    ml_data = merged[ml_cols].dropna().copy()
    ml_data = ml_data[(ml_data['date'] >= '2020-02-01') & (ml_data['date'] <= '2022-10-31')]

    print(f"ML calibration dataset rows: {len(ml_data)}")

    features = [
        'grocery_mobility_lag14', 'workplace_mobility_lag14', 'stringency_index',
        'population_density', 'median_age', 'human_development_index',
        'hospital_beds_per_thousand'
    ]

    X = ml_data[features]
    y = ml_data['reproduction_rate']

    train_idx = ml_data['date'] < '2022-01-01'
    X_train, y_train = X[train_idx], y[train_idx]
    X_test, y_test = X[~train_idx], y[~train_idx]

    print(f"Train size: {len(X_train)}, Test size: {len(X_test)}")

    rf = RandomForestRegressor(n_estimators=100, max_depth=12, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)

    y_pred = rf.predict(X_test)
    test_r2 = r2_score(y_test, y_pred)
    train_r2 = r2_score(y_train, rf.predict(X_train))

    print(f"Train R2 Score: {train_r2:.4f}")
    print(f"Test R2 Score (2022 Backtest): {test_r2:.4f}")

    rf_final = RandomForestRegressor(n_estimators=100, max_depth=12, random_state=42, n_jobs=-1)
    rf_final.fit(X, y)

    print(f"Saving ML model to {model_path}...")
    joblib.dump(rf_final, model_path)

    importances = rf_final.feature_importances_.tolist()
    feature_importance_dict = dict(zip(features, importances))
    feature_importance_dict = dict(sorted(feature_importance_dict.items(), key=lambda item: item[1], reverse=True))

    explainability_data = {
        'train_r2': train_r2,
        'test_r2': test_r2,
        'feature_importances': feature_importance_dict
    }
    with open(explain_path, 'w') as f:
        json.dump(explainability_data, f, indent=4)
    print("Explainability metadata saved.")

    print("\n--- STEP 3: Creating and Seeding SQLite Database ---")
    if os.path.exists(db_path):
        os.remove(db_path)
        print(f"Removed old {db_path}.")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE countries_metadata (
        iso_code TEXT PRIMARY KEY,
        country TEXT,
        population REAL,
        population_density REAL,
        median_age REAL,
        human_development_index REAL,
        hospital_beds_per_thousand REAL,
        vulnerability_index REAL
    )
    """)

    cursor.execute("""
    CREATE TABLE historical_data (
        iso_code TEXT,
        date TEXT,
        new_cases REAL,
        new_deaths REAL,
        new_cases_smoothed REAL,
        new_deaths_smoothed REAL,
        total_cases REAL,
        total_deaths REAL,
        reproduction_rate REAL,
        stringency_index REAL,
        grocery_mobility REAL,
        workplace_mobility REAL,
        PRIMARY KEY (iso_code, date)
    )
    """)

    cursor.execute("""
    CREATE TABLE live_polls (
        poll_timestamp TEXT,
        date TEXT,
        iso_code TEXT,
        country TEXT,
        cases INTEGER,
        deaths INTEGER,
        recovered INTEGER,
        today_cases INTEGER,
        today_deaths INTEGER,
        today_recovered INTEGER,
        active INTEGER,
        critical INTEGER,
        cases_per_million REAL,
        deaths_per_million REAL,
        PRIMARY KEY (poll_timestamp, iso_code)
    )
    """)

    print("Inserting data into database...")
    demographics_db = demographics[[
        'iso_code', 'location', 'population', 'population_density',
        'median_age', 'human_development_index', 'hospital_beds_per_thousand',
        'vulnerability_index'
    ]].rename(columns={'location': 'country'})
    demographics_db.to_sql('countries_metadata', conn, if_exists='append', index=False)

    merged['date_str'] = merged['date'].dt.strftime('%Y-%m-%d')
    historical_db = merged[[
        'iso_code', 'date_str', 'new_cases', 'new_deaths',
        'new_cases_smoothed', 'new_deaths_smoothed', 'total_cases',
        'total_deaths', 'reproduction_rate', 'stringency_index',
        'grocery_mobility', 'workplace_mobility'
    ]].rename(columns={'date_str': 'date'})
    historical_db = historical_db.drop_duplicates(subset=['iso_code', 'date'])
    historical_db.to_sql('historical_data', conn, if_exists='append', index=False)

    cursor.execute("CREATE INDEX idx_hist_iso_date ON historical_data(iso_code, date)")
    cursor.execute("CREATE INDEX idx_live_iso_date ON live_polls(iso_code, date)")

    conn.commit()
    conn.close()

    print("Database built successfully with indexes!")
    print(f"SQLite file size: {os.path.getsize(db_path) / (1024*1024):.2f} MB")


if __name__ == "__main__":
    preprocess_and_build()
