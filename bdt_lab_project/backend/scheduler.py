import sqlite3
import requests
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
import os

DB_PATH = "outbreaksense.db"

# Global state cache for current live numbers and health status
LIVE_CACHE = {
    "global": None,
    "countries": [],
    "last_updated": None,
    "is_delayed": False
}

def get_country_mappings():
    """
    Returns mappings: country_name -> iso_code (ISO3) and iso2 -> iso_code
    from countries_metadata.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT iso_code, country FROM countries_metadata")
    rows = cursor.fetchall()
    
    # We will build mapping for standard ISO2 from disease.sh
    # disease.sh uses ISO2 and ISO3.
    # To map disease.sh countries, we can use name mapping.
    name_to_iso3 = {row[1].lower(): row[0] for row in rows}
    
    # Some name corrections between disease.sh and OWID
    name_to_iso3["usa"] = "USA"
    name_to_iso3["uk"] = "GBR"
    name_to_iso3["united kingdom"] = "GBR"
    name_to_iso3["south korea"] = "KOR"
    name_to_iso3["russia"] = "RUS"
    name_to_iso3["vietnam"] = "VNM"
    name_to_iso3["syria"] = "SYR"
    name_to_iso3["laos"] = "LAO"
    name_to_iso3["venezuela"] = "VEN"
    name_to_iso3["bolivia"] = "BOL"
    name_to_iso3["iran"] = "IRN"
    
    conn.close()
    return name_to_iso3

def seed_historical_live_data():
    """
    On startup, if live_polls table is empty, seeds the last 30 days of historical
    data from disease.sh to ensure charts/sparklines are populated.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM live_polls")
    count = cursor.fetchone()[0]
    
    if count > 0:
        print("Live polls table already has data. Skipping historical seed.")
        conn.close()
        return
        
    print("Live polls table is empty. Seeding historical live data from disease.sh...")
    try:
        # Fetch 30-day historical data for all countries
        url = "https://disease.sh/v3/covid-19/historical?lastdays=30"
        response = requests.get(url, timeout=15)
        if response.status_code != 200:
            print(f"Failed to fetch historical seed: HTTP {response.status_code}")
            conn.close()
            return
            
        data = response.json()
        name_to_iso3 = get_country_mappings()
        
        # Aggregate by country first since disease.sh returns province-level records
        country_timelines = {}
        for entry in data:
            country = entry['country']
            province = entry['province']
            timeline = entry['timeline']
            
            c_key = country.lower()
            if c_key not in country_timelines:
                country_timelines[c_key] = {
                    "name": country,
                    "cases": {},
                    "deaths": {},
                    "recovered": {}
                }
                
            # Sum up values for each date
            for date_str, val in timeline['cases'].items():
                country_timelines[c_key]['cases'][date_str] = country_timelines[c_key]['cases'].get(date_str, 0) + val
            for date_str, val in timeline['deaths'].items():
                country_timelines[c_key]['deaths'][date_str] = country_timelines[c_key]['deaths'].get(date_str, 0) + val
            for date_str, val in timeline['recovered'].items():
                country_timelines[c_key]['recovered'][date_str] = country_timelines[c_key]['recovered'].get(date_str, 0) + val
                
        # Insert into live_polls
        # disease.sh date format in historical timeline: 'M/D/YY' -> convert to YYYY-MM-DD
        insert_query = """
        INSERT OR REPLACE INTO live_polls (
            poll_timestamp, date, iso_code, country, cases, deaths, recovered,
            today_cases, today_deaths, today_recovered, active, critical,
            cases_per_million, deaths_per_million
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        records_to_insert = []
        
        for c_key, details in country_timelines.items():
            name = details['name']
            iso_code = name_to_iso3.get(c_key)
            if not iso_code:
                # Skip countries we can't map
                continue
                
            dates_sorted = sorted(details['cases'].keys(), key=lambda d: datetime.strptime(d, '%m/%d/%y'))
            
            # Retrieve population to calculate rates
            # We look it up from meta later, but let's estimate
            # rates from the final numbers.
            
            for i, date_str in enumerate(dates_sorted):
                dt = datetime.strptime(date_str, '%m/%d/%y')
                date_formatted = dt.strftime('%Y-%m-%d')
                poll_timestamp = f"{date_formatted} 23:59:59"
                
                cum_cases = details['cases'][date_str]
                cum_deaths = details['deaths'][date_str]
                cum_rec = details['recovered'][date_str]
                
                # Compute today's cases (diff with previous day)
                if i > 0:
                    prev_date_str = dates_sorted[i-1]
                    today_cases = max(0, cum_cases - details['cases'][prev_date_str])
                    today_deaths = max(0, cum_deaths - details['deaths'][prev_date_str])
                    today_recovered = max(0, cum_rec - details['recovered'][prev_date_str])
                else:
                    today_cases = 0
                    today_deaths = 0
                    today_recovered = 0
                    
                active = max(0, cum_cases - cum_deaths - cum_rec)
                critical = 0
                cases_per_million = 0.0
                deaths_per_million = 0.0
                
                records_to_insert.append((
                    poll_timestamp, date_formatted, iso_code, name, cum_cases, cum_deaths, cum_rec,
                    today_cases, today_deaths, today_recovered, active, critical,
                    cases_per_million, deaths_per_million
                ))
                
        cursor.executemany(insert_query, records_to_insert)
        conn.commit()
        print(f"Successfully seeded {len(records_to_insert)} historical poll records.")
        
        # Backfill cases_per_million and deaths_per_million using countries_metadata population
        cursor.execute("""
        UPDATE live_polls
        SET cases_per_million = CAST(cases AS REAL) * 1000000.0 / (
            SELECT population FROM countries_metadata WHERE countries_metadata.iso_code = live_polls.iso_code
        ),
        deaths_per_million = CAST(deaths AS REAL) * 1000000.0 / (
            SELECT population FROM countries_metadata WHERE countries_metadata.iso_code = live_polls.iso_code
        )
        WHERE EXISTS (
            SELECT 1 FROM countries_metadata WHERE countries_metadata.iso_code = live_polls.iso_code
        )
        """)
        conn.commit()
        print("Rates per million backfilled.")
        
    except Exception as e:
        print(f"Error seeding historical live data: {e}")
    finally:
        conn.close()

def poll_disease_api():
    """
    Task to poll disease.sh API for latest COVID-19 stats.
    Saves new records to live_polls table and updates the global cache.
    """
    print(f"[{datetime.now()}] Starting live COVID-19 data poll...")
    global LIVE_CACHE
    
    try:
        # 1. Poll Global Summary
        global_res = requests.get("https://disease.sh/v3/covid-19/all", timeout=10)
        if global_res.status_code != 200:
            raise Exception(f"Global API returned status {global_res.status_code}")
        global_data = global_res.json()
        
        # 2. Poll Countries Detail
        countries_res = requests.get("https://disease.sh/v3/covid-19/countries", timeout=10)
        if countries_res.status_code != 200:
            raise Exception(f"Countries API returned status {countries_res.status_code}")
        countries_data = countries_res.json()
        
        # Parse and write to SQLite
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        now = datetime.now()
        poll_timestamp = now.strftime('%Y-%m-%d %H:%M:%S')
        date_str = now.strftime('%Y-%m-%d')
        
        name_to_iso3 = get_country_mappings()
        
        insert_query = """
        INSERT OR REPLACE INTO live_polls (
            poll_timestamp, date, iso_code, country, cases, deaths, recovered,
            today_cases, today_deaths, today_recovered, active, critical,
            cases_per_million, deaths_per_million
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        records_to_insert = []
        parsed_countries = []
        
        for c in countries_data:
            country_name = c['country']
            iso3 = c.get('countryInfo', {}).get('iso3')
            iso2 = c.get('countryInfo', {}).get('iso2')
            
            # Resolve to OWID ISO3
            iso_code = name_to_iso3.get(country_name.lower())
            if not iso_code and iso3:
                iso_code = iso3
                
            if not iso_code:
                # If we still can't map it, skip
                continue
                
            cases = c.get('cases', 0)
            deaths = c.get('deaths', 0)
            recovered = c.get('recovered', 0)
            today_cases = c.get('todayCases', 0)
            today_deaths = c.get('todayDeaths', 0)
            today_recovered = c.get('todayRecovered', 0)
            active = c.get('active', 0)
            critical = c.get('critical', 0)
            cases_per_million = c.get('casesPerOneMillion', 0.0)
            deaths_per_million = c.get('deathsPerOneMillion', 0.0)
            
            records_to_insert.append((
                poll_timestamp, date_str, iso_code, country_name, cases, deaths, recovered,
                today_cases, today_deaths, today_recovered, active, critical,
                cases_per_million, deaths_per_million
            ))
            
            # Prepare for cache
            parsed_countries.append({
                "iso_code": iso_code,
                "iso2": iso2,
                "country": country_name,
                "cases": cases,
                "deaths": deaths,
                "recovered": recovered,
                "today_cases": today_cases,
                "today_deaths": today_deaths,
                "today_recovered": today_recovered,
                "active": active,
                "critical": critical,
                "cases_per_million": cases_per_million,
                "deaths_per_million": deaths_per_million
            })
            
        cursor.executemany(insert_query, records_to_insert)
        conn.commit()
        conn.close()
        
        # Update Cache
        LIVE_CACHE["global"] = {
            "cases": global_data.get("cases", 0),
            "deaths": global_data.get("deaths", 0),
            "recovered": global_data.get("recovered", 0),
            "today_cases": global_data.get("todayCases", 0),
            "today_deaths": global_data.get("todayDeaths", 0),
            "today_recovered": global_data.get("todayRecovered", 0),
            "active": global_data.get("active", 0)
        }
        LIVE_CACHE["countries"] = parsed_countries
        LIVE_CACHE["last_updated"] = poll_timestamp
        LIVE_CACHE["is_delayed"] = False
        
        print(f"[{datetime.now()}] Live poll completed successfully. Cached {len(parsed_countries)} countries.")
        
    except Exception as e:
        print(f"[{datetime.now()}] Live poll failed: {e}")
        # Mark cache as delayed but preserve previous data
        LIVE_CACHE["is_delayed"] = True
        
def start_scheduler():
    """
    Starts the background scheduler.
    """
    # Seed historical live data if table is empty
    seed_historical_live_data()
    
    # Run initial poll synchronously to fill cache at startup
    poll_disease_api()
    
    scheduler = BackgroundScheduler()
    # Poll every 20 minutes
    scheduler.add_job(poll_disease_api, 'interval', minutes=20, id='disease_sh_poll')
    scheduler.start()
    print("Background scheduler started (interval: 20 minutes).")
    return scheduler
