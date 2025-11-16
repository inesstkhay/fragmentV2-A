import pandas as pd
import json

# === PARAMÈTRES ===
INPUT_CSV = "data.csv"
OUTPUT_GEOJSON = "datam.geojson"

# === FONCTION POUR TRANSFORMER LES COORDONNÉES EN GEOMETRY GEOJSON ===
import json
import re

def parse_geometry(row):
    geom_type = row["type_geom"].strip()
    raw = str(row["coordinates"]).strip()

    # Nettoyage général
    raw = raw.replace('"""', '"') \
             .replace("\r", " ") \
             .replace("\n", " ") \
             .replace("\t", " ") \
             .strip()

    # 0) Cas de chaînes avec préfixe "coordinates"
    if "coordinates" in raw:
        # Extraire le contenu JSON entre le premier '[' et le dernier ']'
        if "[" in raw and "]" in raw:
            json_part = raw[raw.index("[") : raw.rindex("]") + 1]
            try:
                coords = json.loads(json_part)
            except Exception:
                coords = None
        else:
            coords = None
    else:
        coords = None

    # === CAS JSON — on a pu parser ===
    if coords is not None:
        # POINT: [lon, lat]
        if isinstance(coords, list) and len(coords) == 2 and isinstance(coords[0], (float, int)):
            return {
                "type": "Point",
                "coordinates": coords
            }

        # LINESTRING: [[lon, lat], ...]
        if isinstance(coords, list) and isinstance(coords[0], list) and isinstance(coords[0][0], (float, int)):
            return {
                "type": "LineString",
                "coordinates": coords
            }

        # POLYGON: [[[lon, lat], ...]]
        if isinstance(coords, list) and isinstance(coords[0], list) and isinstance(coords[0][0], list):
            return {
                "type": "Polygon",
                "coordinates": coords
            }

    # === CAS NON-JSON ===
    # Interdire les faux points si raw contient des mots-clés
    if ("[" not in raw and "]" not in raw and "coordinates" not in raw):

        # POINT simple "lon,lat"
        if ";" not in raw and raw.count(",") == 1:
            lon, lat = raw.split(",", maxsplit=1)
            return {
                "type": "Point",
                "coordinates": [float(lon), float(lat)]
            }

        # LINESTRING ou POLYGON "plats"
        if ";" in raw:
            pts = []
            for part in raw.split(";"):
                part = part.strip()
                if "," in part:
                    lon, lat = part.split(",", maxsplit=1)
                    pts.append([float(lon), float(lat)])

            if geom_type == "LineString":
                return {"type": "LineString", "coordinates": pts}

            return {"type": "Polygon", "coordinates": [pts]}

    # Si rien n'a marché → erreur explicite
    raise ValueError(f"Impossible d'interpréter les coordonnées : {raw}")




# === CHARGEMENT DU CSV ===
df = pd.read_csv(INPUT_CSV)

# Correction automatique : remplacer les virgules des fuzzy sets → points décimaux
for col in df.columns:
    if col.startswith("FS_"):  # tous les fuzzy sets commencent par FS_
        df[col] = df[col].astype(str).str.replace(",", ".")
        df[col] = df[col].astype(float)

# === CONSTRUCTION DU GEOJSON ===
features = []

for _, row in df.iterrows():

    geometry = parse_geometry(row)

    # Toutes les colonnes à intégrer dans "properties"
    properties = row.drop(["type_geom", "coordinates"]).to_dict()

    # Conversion automatique des "nan" en "-"
    for k, v in properties.items():
        if pd.isna(v):
            properties[k] = "-"

    # Conformité boolean : si colonne dans l'ancien format
    for k, v in properties.items():
        if str(v).lower() in ["true", "false"]:
            properties[k] = v == "true"

    feature = {
        "type": "Feature",
        "geometry": geometry,
        "properties": properties
    }

    features.append(feature)

geojson = {
    "type": "FeatureCollection",
    "features": features
}

# === EXPORT ===
with open(OUTPUT_GEOJSON, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False, indent=2)

print(f"GEOJSON généré : {OUTPUT_GEOJSON}")
