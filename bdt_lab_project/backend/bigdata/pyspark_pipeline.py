import os
import json
import glob
import sqlite3
from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, IntegerType, StringType, StructField, StructType


def build_spark_session(app_name="OutbreakSensePySpark"):
    """Create and configure a SparkSession for scalable preprocessing."""
    return (
        SparkSession.builder.master("local[*]")
        .appName(app_name)
        .config("spark.sql.shuffle.partitions", "4")
        .config("spark.driver.memory", "2g")
        .config("spark.executor.memory", "2g")
        .getOrCreate()
    )


def _safe_cast_columns(df, cast_map):
    """Apply explicit casts to selected columns for consistent schema."""
    for col_name, dtype in cast_map.items():
        if col_name in df.columns:
            df = df.withColumn(col_name, F.col(col_name).cast(dtype))
    return df


def load_and_preprocess_data(project_root=None, spark=None):
    """
    Load OWID COVID-19, mobility, demographic, and stringency datasets using Spark DataFrames,
    then perform all preprocessing steps before converting to pandas for model training.
    """
    project_root = Path(project_root or Path(__file__).resolve().parents[2])
    if spark is None:
        spark = build_spark_session()

    # ------------------------------------------------------------------
    # 1) Load OWID COVID-19 dataset as a Spark DataFrame
    # ------------------------------------------------------------------
    owid_path = project_root / "raw" / "owid-covid-data.csv"
    owid_cols = [
        'iso_code', 'continent', 'location', 'date', 'total_cases', 'new_cases',
        'new_cases_smoothed', 'total_deaths', 'new_deaths', 'new_deaths_smoothed',
        'reproduction_rate', 'stringency_index', 'population', 'population_density',
        'median_age', 'human_development_index', 'hospital_beds_per_thousand',
        'total_deaths_per_million'
    ]

    # Read the CSV with Spark; keep only the columns needed for preprocessing.
    owid_df = (
        spark.read.option("header", True)
        .csv(str(owid_path), inferSchema=True)
        .select(*owid_cols)
    )

    # Cast the date column to a proper timestamp and keep only standard countries.
    owid_df = (
        owid_df.withColumn("date", F.to_date(F.col("date")))
        .filter(~F.col("iso_code").startswith("OWID_"))
    )

    # ------------------------------------------------------------------
    # 2) Load demographic metadata from the OWID dataset itself
    # ------------------------------------------------------------------
    # Aggregate to one row per country to derive country-level demographic metadata.
    demographics_df = (
        owid_df.groupBy("iso_code", "location")
        .agg(
            F.last("population").alias("population"),
            F.last("population_density").alias("population_density"),
            F.last("median_age").alias("median_age"),
            F.last("human_development_index").alias("human_development_index"),
            F.last("hospital_beds_per_thousand").alias("hospital_beds_per_thousand")
        )
    )

    # ------------------------------------------------------------------
    # 3) Handle missing values and engineer the OVI feature
    # ------------------------------------------------------------------
    # Fill missing demographic values using country-level medians.
    median_values = {
        "population": demographics_df.approxQuantile("population", [0.5], 0.01)[0],
        "population_density": demographics_df.approxQuantile("population_density", [0.5], 0.01)[0],
        "median_age": demographics_df.approxQuantile("median_age", [0.5], 0.01)[0],
        "human_development_index": demographics_df.approxQuantile("human_development_index", [0.5], 0.01)[0],
        "hospital_beds_per_thousand": demographics_df.approxQuantile("hospital_beds_per_thousand", [0.5], 0.01)[0],
    }

    for col_name, med_val in median_values.items():
        if med_val is None:
            med_val = 0.0
        demographics_df = demographics_df.withColumn(
            col_name,
            F.when(F.col(col_name).isNull(), F.lit(med_val)).otherwise(F.col(col_name))
        )

    from pyspark.sql.window import Window

    # Compute the Outbreak Vulnerability Index (OVI) using normalized components.
    # Higher OVI means a country is more vulnerable because of older populations,
    # fewer hospital beds, and lower HDI.
    global_window = Window.partitionBy(F.lit(1))
    demographics_df = demographics_df.withColumn(
        "S_age",
        F.when(
            F.col("median_age").isNotNull(),
            (F.col("median_age") - F.avg("median_age").over(global_window)) / (F.max("median_age").over(global_window) - F.min("median_age").over(global_window))
        ).otherwise(F.lit(0.5))
    )
    demographics_df = demographics_df.withColumn(
        "S_beds",
        F.when(
            F.col("hospital_beds_per_thousand").isNotNull(),
            1.0 - ((F.col("hospital_beds_per_thousand") - F.min("hospital_beds_per_thousand").over(global_window)) / (F.max("hospital_beds_per_thousand").over(global_window) - F.min("hospital_beds_per_thousand").over(global_window)))
        ).otherwise(F.lit(0.5))
    )
    demographics_df = demographics_df.withColumn(
        "S_hdi",
        F.when(
            F.col("human_development_index").isNotNull(),
            1.0 - ((F.col("human_development_index") - F.min("human_development_index").over(global_window)) / (F.max("human_development_index").over(global_window) - F.min("human_development_index").over(global_window)))
        ).otherwise(F.lit(0.5))
    )

    demographics_df = demographics_df.withColumn(
        "vulnerability_index",
        0.4 * F.col("S_age") + 0.3 * F.col("S_beds") + 0.3 * F.col("S_hdi")
    )

    # ------------------------------------------------------------------
    # 4) Load Google Mobility reports and preprocess them with Spark
    # ------------------------------------------------------------------
    # The mobility data is distributed across many CSV files; Spark is ideal here.
    mobility_dir = project_root / "raw" / "Region_Mobility_Report_CSVs"
    mobility_files = glob.glob(str(mobility_dir / "*_Region_Mobility_Report.csv"))

    # A schema is used to preserve the needed columns and avoid parsing issues.
    mobility_schema = StructType([
        StructField("country_region", StringType(), True),
        StructField("sub_region_1", StringType(), True),
        StructField("date", StringType(), True),
        StructField("grocery_and_pharmacy_percent_change_from_baseline", DoubleType(), True),
        StructField("workplaces_percent_change_from_baseline", DoubleType(), True),
        StructField("iso2", StringType(), True),
    ])

    mobility_dfs = []
    for mob_file in mobility_files:
        try:
            df = (
                spark.read.option("header", True)
                .schema(mobility_schema)
                .csv(mob_file)
                .select(
                    "country_region",
                    "sub_region_1",
                    "date",
                    "grocery_and_pharmacy_percent_change_from_baseline",
                    "workplaces_percent_change_from_baseline",
                )
            )
            mobility_dfs.append(df)
        except Exception:
            continue

    if mobility_dfs:
        mobility_df = mobility_dfs[0]
        for other_df in mobility_dfs[1:]:
            mobility_df = mobility_df.unionByName(other_df)
    else:
        mobility_df = spark.createDataFrame([], schema=mobility_schema)

    # Keep country-level data only (sub_region_1 is null), which is consistent with the previous workflow.
    mobility_df = (
        mobility_df.withColumn("date", F.to_date(F.col("date")))
        .filter(F.col("sub_region_1").isNull())
        .withColumnRenamed("grocery_and_pharmacy_percent_change_from_baseline", "grocery_mobility")
        .withColumnRenamed("workplaces_percent_change_from_baseline", "workplace_mobility")
    )

    # Map country names to OWID country names using a small dictionary and then to ISO3 codes.
    name_overrides = {
        'The Bahamas': 'Bahamas',
        "Cte d'Ivoire": "Cote d'Ivoire",
        "Côte d'Ivoire": "Cote d'Ivoire",
        'Myanmar (Burma)': 'Myanmar',
        'Runion': 'Reunion',
        'Réunion': 'Reunion'
    }

    # Create a Spark DataFrame with the mapping from country names to ISO codes.
    country_lookup = (
        owid_df.select("location", "iso_code")
        .dropDuplicates()
        .withColumnRenamed("location", "country_region")
    )

    @F.udf(StringType())
    def normalize_country_name(value):
        return name_overrides.get(value, value)

    country_lookup = country_lookup.withColumn(
        "country_region",
        normalize_country_name(F.col("country_region"))
    )

    # Merge mobility data with ISO code mapping using an efficient join.
    mobility_df = (
        mobility_df.join(country_lookup, on="country_region", how="left")
        .filter(F.col("iso_code").isNotNull())
        .drop("country_region")
    )

    # Fill missing mobility with 0.0 so the later lag features are stable.
    mobility_df = (
        mobility_df.withColumn("grocery_mobility", F.coalesce(F.col("grocery_mobility"), F.lit(0.0)))
        .withColumn("workplace_mobility", F.coalesce(F.col("workplace_mobility"), F.lit(0.0)))
    )

    # ------------------------------------------------------------------
    # 5) Merge OWID data with mobility and demographics
    # ------------------------------------------------------------------
    # This join links the daily disease time series with mobility and static country-level demographics.
    owid_with_demo = owid_df.join(demographics_df.select("iso_code", "vulnerability_index"), on="iso_code", how="left")
    merged_df = (
        owid_with_demo.join(mobility_df, on=["iso_code", "date"], how="left")
        .withColumn("grocery_mobility", F.coalesce(F.col("grocery_mobility"), F.lit(0.0)))
        .withColumn("workplace_mobility", F.coalesce(F.col("workplace_mobility"), F.lit(0.0)))
        .withColumn("stringency_index", F.coalesce(F.col("stringency_index"), F.lit(0.0)))
    )

    # Sort the data by country and date to allow lag generation.
    merged_df = merged_df.orderBy("iso_code", "date")

    # ------------------------------------------------------------------
    # 6) Create 14-day lag mobility features using Spark window functions
    # ------------------------------------------------------------------
    # These lag features are engineered to match the original workflow and to reflect the fact that
    # mobility changes influence later transmission patterns with a 14-day delay.
    from pyspark.sql.window import Window
    country_window = Window.partitionBy("iso_code").orderBy("date")
    merged_df = (
        merged_df.withColumn("grocery_mobility_lag14", F.lag(F.col("grocery_mobility"), 14).over(country_window))
        .withColumn("workplace_mobility_lag14", F.lag(F.col("workplace_mobility"), 14).over(country_window))
        .withColumn("grocery_mobility_lag14", F.coalesce(F.col("grocery_mobility_lag14"), F.lit(0.0)))
        .withColumn("workplace_mobility_lag14", F.coalesce(F.col("workplace_mobility_lag14"), F.lit(0.0)))
    )

    # Cache the merged dataset because it is reused in multiple downstream steps.
    merged_df = merged_df.repartition(2)
    merged_df.cache()

    # ------------------------------------------------------------------
    # 7) Prepare the final feature set for ML training
    # ------------------------------------------------------------------
    # Keep only rows with a valid target and a reasonable date range for training.
    ml_df = (
        merged_df.select(
            "reproduction_rate",
            "grocery_mobility_lag14",
            "workplace_mobility_lag14",
            "stringency_index",
            "population_density",
            "median_age",
            "human_development_index",
            "hospital_beds_per_thousand",
            "date",
            "iso_code"
        )
        .filter(F.col("reproduction_rate").isNotNull())
        .filter(F.col("date") >= F.lit("2020-02-01"))
        .filter(F.col("date") <= F.lit("2022-10-31"))
    )

    ml_df = ml_df.withColumn("reproduction_rate", F.col("reproduction_rate").cast(DoubleType()))
    ml_df = _safe_cast_columns(
        ml_df,
        {
            "grocery_mobility_lag14": DoubleType(),
            "workplace_mobility_lag14": DoubleType(),
            "stringency_index": DoubleType(),
            "population_density": DoubleType(),
            "median_age": DoubleType(),
            "human_development_index": DoubleType(),
            "hospital_beds_per_thousand": DoubleType(),
        }
    )

    # ------------------------------------------------------------------
    # 8) Convert to pandas only at the training boundary
    # ------------------------------------------------------------------
    # The Random Forest training stage continues to use the same features and target.
    pandas_df = ml_df.toPandas()

    return {
        "merged_df": merged_df,
        "demographics_df": demographics_df,
        "ml_df": ml_df,
        "pandas_df": pandas_df,
        "metadata": {
            "country_count": demographics_df.count(),
            "merged_rows": merged_df.count(),
            "ml_rows": ml_df.count(),
        }
    }
