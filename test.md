Here's a functional graph of every endpoint in the system, grouped by which component initiates the call. Arrow labels indicate what is sent (request payload / query) and the response in italics.

  flowchart LR
    %% ========= Nodes =========
    Client["🖥️ Client (Browser)<br/>Next.js 14 / MapLibre / deck.gl"]
    Next["⚙️ Next.js Server<br/>(Vercel runtime)"]
    Valhalla["🛣️ Valhalla<br/>Railway :8002"]
    Supa["🗄️ Supabase<br/>Postgres + PostGIS + Storage"]
    OFM["🗺️ OpenFreeMap<br/>tiles.openfreemap.org"]
    Photon["📍 Photon<br/>photon.komoot.io"]
    Nominatim["📍 Nominatim<br/>nominatim.openstreetmap.org"]
    OR["🤖 OpenRouter<br/>openrouter.ai → minimax/minimax-01"]
    EProstor["🏛️ e-prostor (GURS/MNVP)<br/>ipi.eprostor.gov.si"]
    ARSO["🌲 ARSO GeoServer<br/>gis.arso.gov.si"]
    Geofabrik["📦 Geofabrik<br/>download.geofabrik.de"]
    GURSmirror["📦 GURS mirror<br/>github.com/stefanb/gurs-rpe"]
    Kontur["📦 Kontur (HDX)<br/>data.humdata.org"]
    SURS["📊 SURS SiStat<br/>pxweb.stat.si"]
    ETL["🐍 ETL Pipeline<br/>(offline, Python)"]
    Static["📁 /public/data/*<br/>(static JSON shipped w/ build)"]

    %% ========= Client → external/internal =========
    Client -- "GET /styles/positron, /styles/dark-matter<br/><i>← vector basemap tiles</i>" --> OFM
    Client -- "GET /api/?q=<query>&bbox=SI&limit=6<br/><i>← address suggestions</i>" --> Photon
    Client -- "GET /search?q=..&countrycodes=si<br/><i>← fallback geocode</i>" --> Nominatim

    Client -- "GET /storage/v1/object/public/cells/cell_scores_lite.json<br/>GET .../cells/cell_demand_lite.json<br/>GET .../overlays/obcine_scored.geojson<br/>GET .../overlays/zavarovana_si.geojson<br/><i>← 
  gzipped JSON / GeoJSON</i>" --> Supa
    Client -- "POST /rest/v1/rpc/amenities_for_point  {p_lat,p_lng,p_mode}<br/>GET /rest/v1/cell_scores?h3=eq.X<br/>GET /rest/v1/obcine?naziv=eq.X<br/>POST /rest/v1/rpc/llm_search_cells
  {filter_spec,p_limit}<br/><i>+ apikey/Bearer anon</i>" --> Supa

    Client -- "GET wfs-si-mnvp-pa/wfs?REQUEST=GetFeature<br/>&TYPENAMES=SI.MNVP.PA:NRP_OPN&CQL_FILTER=BBOX+IN(zones)<br/>GET wfs-si-gurs-kn/wfs?TYPENAMES=SI.GURS.KN:STAVBE_OBRIS&BBOX=..<br/><i>← OPN zones +  
  building footprints</i>" --> EProstor

    Client -- "GET /data/cell_cat_scores.json<br/>GET /data/building_suggestions.json<br/>GET /data/obcine_demographics.json<br/>GET /data/fro.geojson" --> Static

    Client -- "POST /api/llm  {kind:'search'|'narrative', query, h3, score,..}<br/>POST /api/valhalla/{isochrone\|route\|sources_to_targets\|..}" --> Next

    %% ========= Next.js server → upstream =========
    Next -- "POST /isochrone  {locations,costing,contours}<br/>POST /route  {locations,costing}<br/>POST /sources_to_targets  {sources,targets,costing}<br/><i>(proxy to avoid CORS preflight)</i>" --> Valhalla
    Next -- "POST /api/v1/chat/completions<br/>{model: minimax/minimax-01, messages, response_format:json_object}<br/><i>← parsed filter_spec + Slovenian reply</i>" --> OR
    Next -- "GET /api/?q=<target_town>&limit=1<br/><i>← lat/lng for H3 disk</i>" --> Photon
    Next -- "POST /rest/v1/rpc/llm_search_cells  {filter_spec:{required_category_indices,h3_in},p_limit}<br/><i>+ service/anon key</i>" --> Supa

    %% ========= ETL (offline, build-time) =========
    Geofabrik   -- "curl slovenia-latest.osm.pbf (~300 MB)" --> ETL
    GURSmirror  -- "curl OB.geojson (212 občine)" --> ETL
    ARSO        -- "WFS GetFeature ZOS_ZO_PLG_DRZ + ZOS_N2K_PLG" --> ETL
    Kontur      -- "kontur_population_SI.gpkg" --> ETL
    SURS        -- "PxWeb /api/v1/sl/Data (age shares, indicators)" --> ETL
    ETL -- "POST /isochrone  ×112,866 (amenity bake)" --> Valhalla
    ETL -- "psql + storage upload<br/>cell_scores, cell_amenities, obcine, overlays/*" --> Supa
    ETL -- "writes cell_scores_lite, cell_demand_lite,<br/>obcine_scored, obcine_demographics,<br/>cell_cat_scores, building_suggestions, fro" --> Static

  Legend / endpoint table

  ┌─────────┬──────────────────────────────────────────────────────────────┬───────────────┬───────────────────────────────────────┐
  │ Caller  │                           Endpoint                           │    Method     │                Payload                │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ tiles.openfreemap.org/styles/{positron,dark-matter}          │ GET           │ — (style + tiles)                     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ photon.komoot.io/api/?q=…&bbox=SI                            │ GET           │ address query                         │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ nominatim.openstreetmap.org/search                           │ GET           │ fallback geocode                      │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ {SUPABASE}/storage/v1/object/public/{cells,overlays}/…       │ GET           │ — (static GeoJSON/JSON)               │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ {SUPABASE}/rest/v1/rpc/amenities_for_point                   │ POST          │ {p_lat,p_lng,p_mode}                  │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ {SUPABASE}/rest/v1/cell_scores?h3=eq.X                       │ GET           │ —                                     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ {SUPABASE}/rest/v1/obcine?naziv=eq.X                         │ GET           │ —                                     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ ipi.eprostor.gov.si/wfs-si-mnvp-pa/wfs (OPN zones)           │ GET           │ WFS GetFeature + CQL BBOX             │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs (building footprints) │ GET           │ WFS GetFeature + BBOX                 │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ /api/llm (own Next route)                                    │ POST          │ {kind, query | h3+score+walk_min}     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Client  │ /api/valhalla/{endpoint} (own proxy)                         │ POST          │ Valhalla body                         │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Next.js │ openrouter.ai/api/v1/chat/completions                        │ POST          │ {model: minimax/minimax-01, messages} │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Next.js │ photon.komoot.io/api/?q=<target_town>                        │ GET           │ town name for H3 disk                 │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Next.js │ {SUPABASE}/rest/v1/rpc/llm_search_cells                      │ POST          │ {filter_spec, p_limit}                │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ Next.js │ {VALHALLA}/{isochrone,route,sources_to_targets,...}          │ POST          │ locations + costing                   │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ download.geofabrik.de/europe/slovenia-latest.osm.pbf         │ GET           │ —                                     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ github.com/stefanb/gurs-rpe/.../OB.geojson                   │ GET           │ —                                     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ gis.arso.gov.si/geoserver/ows (ZOS_ZO_PLG_DRZ, ZOS_N2K_PLG)  │ GET           │ WFS GetFeature                        │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ data.humdata.org/.../kontur_population_SI.gpkg               │ GET           │ —                                     │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ pxweb.stat.si/SiStatData/api/v1/sl/Data                      │ GET           │ PxWeb queries (age, indicators)       │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ {VALHALLA}/isochrone × 112,866                               │ POST          │ per-amenity bake                      │
  ├─────────┼──────────────────────────────────────────────────────────────┼───────────────┼───────────────────────────────────────┤
  │ ETL     │ Supabase Postgres + Storage                                  │ psql / upload │ tables + overlay files                │
  └─────────┴──────────────────────────────────────────────────────────────┴───────────────┴───────────────────────────────────────┘

  A couple of points worth flagging that the diagram makes obvious:

  - crp.gis.si does not appear anywhere in the codebase — you mentioned it but it isn't currently wired in.
  - The two e-prostor WFS endpoints are called directly from the browser (no proxy), which is unusual for hackathon stacks and worth noting if CORS ever breaks.
  - Minimax is reached via OpenRouter (model: minimax/minimax-01), not directly — only the Next.js server holds the key.
  - Valhalla is always called through the Next.js proxy (/api/valhalla/*) because the container 405s on CORS preflight.