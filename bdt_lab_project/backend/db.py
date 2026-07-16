import sqlite3
import os
import json
from pathlib import Path


def get_db_connection(db_path="outbreaksense.db"):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def get_countries(db_path="outbreaksense.db"):
    if not os.path.exists(db_path):
        return []
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT iso_code, country, population, population_density, median_age, 
               human_development_index, hospital_beds_per_thousand, vulnerability_index
        FROM countries_metadata
        ORDER BY country ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_historical_country_data(country_code, db_path="outbreaksense.db"):
    if not os.path.exists(db_path):
        return []
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT date, new_cases, new_deaths, new_cases_smoothed, new_deaths_smoothed, 
               total_cases, total_deaths, reproduction_rate, stringency_index, 
               grocery_mobility, workplace_mobility
        FROM historical_data
        WHERE iso_code = ?
        ORDER BY date ASC
    """, (country_code,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_subnational_locations(country_code=None):
    data_path = Path(__file__).resolve().parent / "subnational_locations.json"
    if not data_path.exists():
        return []

    with open(data_path, 'r', encoding='utf-8') as f:
        locations = json.load(f)

    if country_code:
        return [loc for loc in locations if loc.get('country_iso') == country_code]
    return locations


def get_explainability_data(explain_path="explainability.json"):
    if not os.path.exists(explain_path):
        return {
            "train_r2": 0.0,
            "test_r2": 0.0,
            "feature_importances": {}
        }
    with open(explain_path, 'r') as f:
        return json.load(f)
