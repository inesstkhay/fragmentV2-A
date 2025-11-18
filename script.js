/***************************************************
 * backdoorurbanism — script.js 
 ***************************************************/

/*---------------------------------------
  1) BOUTON : TOGGLE LÉGENDE
---------------------------------------*/
document.getElementById('toggle-legend-btn').addEventListener('click', () => {
  const legend = document.getElementById('criteria-legend');
  legend.style.display = (legend.style.display === 'none' || legend.style.display === '') ? 'block' : 'none';
});


/*---------------------------------------
  2) CONSTANTES / ÉTAT GLOBAL / DOM
---------------------------------------*/
let currentView = 'map';                   // vue active globale
const montreuilView = [48.8710, 2.4330];
const montreuilZoom = 15;
const toulouseView  = [43.5675824, 1.4000176];
const toulouseZoom  = 15;
let currentLocation = 'montreuil';         // localisation initiale
let patternsVersion = 0;                   // (NOTE: compteur; non utilisé ailleurs)

// Références DOM fréquentes
const proxemicView  = document.getElementById('proxemic-view');

// État de données
let allLayers      = [];   // toutes couches cliquables (fragments & discours)
let dataGeojson    = [];   // fragments Montreuil
let datamGeojson   = [];   // fragments Mirail
let patterns       = {};   // { P1: {name,elements[],criteria{}}, ... }
let patternNames   = {};   // { P1:'P1', ... } (alias si besoin)
let discoursLayer  = null; // couche de points "discours" (pane dédié)
let combinedFeatures = []; // concat Montreuil + Mirail (utile patterns-map)

// Panne "discours" au-dessus
let map = L.map('map').setView(montreuilView, montreuilZoom);
map.createPane('pane-discours');
map.getPane('pane-discours').style.zIndex = 650; // > autres couches

// Fond de carte (dark)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors, © CartoDB'
}).addTo(map);

/*---------------------------------------
ÉTAT CRÉATION D’UNITÉ (patterns-map)
  (la logique détaillée arrive en Partie 2)
---------------------------------------*/
let unitCreation = {
  active: false,
  ringsVisible: true,
  mouseMoveHandler: null
};
let unitMap = null;             // carte dédiée "Unité de projet" (Partie 2)
let unitLayerGroup = null;      // toutes les unités dessinées
let unitContextGroup = null;    // contexte (contours, base grise, etc.)



/* ------------ Helpers images : nettoyage & création d'<img> ------------- */
function cleanPhotoUrl(u) {
  if (!u) return null;
  // trim + force https
  let s = String(u).trim().replace(/^http:\/\//i, 'https://');
  // garde uniquement l'URL (si du HTML a été collé)
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

function normalizePhotos(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (typeof p === 'string') {
    // accepte séparateur virgule ou point-virgule
    return p.split(/[;,]\s*/).filter(Boolean);
  }
  return [];
}

function makeImg(src, alt = 'photo', { priority = 'low', lazy = true } = {}) {
  const url = cleanPhotoUrl(src);
  if (!url) return null;

  const img = document.createElement('img');
  img.alt = alt;
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => { img.style.display = 'none'; };

  // priorité réseau (Chrome/Edge/Opera + Safari récents)
  img.setAttribute('fetchpriority', priority);
  img.fetchPriority = priority;

  if (lazy) img.loading = 'lazy';

  if (lazy && 'IntersectionObserver' in window) {
    // tiny placeholder pour déclencher la mise en page instantanément
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    img.dataset.src = url;
    ensureImgObserver().observe(img);
  } else {
    // images prioritaires / peu nombreuses : on charge tout de suite
    img.src = url;
  }
  return img;
}

let __imgObserver = null;
function ensureImgObserver() {
  if (__imgObserver) return __imgObserver;
  __imgObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      const real = img.dataset.src;
      if (real) {
        img.src = real;
        img.removeAttribute('data-src');
      }
      obs.unobserve(img);
    });
  }, { rootMargin: '800px 0px', threshold: 0.01 }); // précharge ~800px avant
  return __imgObserver;
}


/*---------------------------------------
  BASCULE TOULOUSE / MONTREUIL
---------------------------------------*/
function toggleLocation() {
  const locationButton = document.getElementById('toggle-location-btn');

  // Choisir/initialiser la carte cible selon la vue courante
  let targetMap = map; // défaut: carte "Fragments"

  if (currentView === 'patterns-map') {
    // S'assure que la carte patterns existe
    initPatternMapOnce?.();
    if (patternMap) targetMap = patternMap;            // << plus de window.
  } else if (currentView === 'unit' || currentView === 'unit-view') {
    // S'assure que la carte unité existe
    ensureUnitMap?.();
    if (unitMap) targetMap = unitMap;                  // << plus de window.
  }

  // Bascule de localisation
  if (currentLocation === 'montreuil') {
    targetMap.setView([43.5675824, 1.4000176], 15); // Toulouse
    if (locationButton) locationButton.textContent = 'Voir Montreuil';
    currentLocation = 'toulouse';
  } else {
    targetMap.setView([48.8710, 2.4330], 15);       // Montreuil
    if (locationButton) locationButton.textContent = 'Voir Toulouse';
    currentLocation = 'montreuil';
  }
}


/*---------------------------------------
 SIDEBARS CLASSIQUES (spatial/discours)
  (les panneaux riches sont gérés par les onglets — Partie 2)
---------------------------------------*/
function openSidebar(el) {
  if (!el) return;
  el.style.display   = 'block';
  el.style.position  = 'fixed';
  el.style.top       = '90px';
  el.style.right     = '10px';
  el.style.maxHeight = 'calc(100vh - 120px)';
  el.style.overflowY = 'auto';
  el.style.zIndex    = '4001'; // au-dessus du footer & panes
}

// Helper central qui route vers les bons panneaux (Partie 2)
function showDetails(props) {
  clearAllTabbedTabs(); // exclusif : 1 clic = 1 set d’infos (fonction en Partie 2)

  if (props.isPattern) {
    const key = props.patternKey || 'Pattern';
    openTab({                         // openTab / renderPatternPanel en Partie 2
      id: `pattern-${key}`,
      title: key,
      kind: 'pattern',
      render: (panel) => renderPatternPanel(panel, key, {
        criteria: props.criteria || {},
        elements: props.elements || []
      })
    });
  } else if (props.isDiscourse) {
    openTab({                         // renderDiscoursePanel en Partie 2
      id: `disc-${props.id || Math.random().toString(36).slice(2)}`,
      title: props.id || 'Discours',
      kind: 'discourse',
      render: (panel) => renderDiscoursePanel(panel, props)
    });
  } else {
    const fid = props.id || Math.random().toString(36).slice(2);
    openTab({                         // renderFragmentPanel en Partie 2
      id: `frag-${fid}`,
      title: props.id || 'Fragment',
      kind: 'fragment',
      render: (panel) => renderFragmentPanel(panel, props)
    });
  }

  // masque les anciennes sidebars (sécurité)
  const sb1 = document.getElementById('spatial-sidebar');
  const sb2 = document.getElementById('discourse-sidebar');
  if (sb1) sb1.style.display = 'none';
  if (sb2) sb2.style.display = 'none';
}

function closeSidebars() {
  const sb1 = document.getElementById('spatial-sidebar');
  const sb2 = document.getElementById('discourse-sidebar');
  if (sb1) sb1.style.display = 'none';
  if (sb2) sb2.style.display = 'none';
  clearAllTabbedTabs(); // (Partie 2)
}


/*---------------------------------------
  8) FILTRES + RECALCUL PATTERNS
---------------------------------------*/
function applyFilters() {
  const showDiscourses = true; // aujourd’hui: on affiche tjs les discours
  const activeZones = Array.from(document.querySelectorAll('.filter-zone:checked')).map(cb => cb.value);

  allLayers.forEach(layer => {
    const props = layer.feature.properties;
    const isDiscourse = props.isDiscourse;

    const showLayer = isDiscourse ? showDiscourses : activeZones.includes(layer.zone);
    if (showLayer) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  });

  // recalcul patterns sur les éléments visibles (hors discours)
  const visibleFeatures = allLayers
    .filter(layer => map.hasLayer(layer))
    .map(layer => layer.feature)
    .filter(f => !f.properties.isDiscourse);

  patterns = identifyPatterns(visibleFeatures);

  // rafraîchit autres vues selon currentView (les fonctions sont en Partie 2)
  if (currentView === 'proxemic')       showProxemicView();
  else if (currentView === 'gallery')   showGalleryView();

  // discours au premier plan si nécessaire
  if (discoursLayer) discoursLayer.bringToFront();
}

// écoute modifications des checkboxes de zones
document.querySelectorAll('.filter-zone').forEach(cb => {
  cb.addEventListener('change', () => {
    applyFilters();

    if (currentView === 'patterns-map') {
      renderPatternBaseGrey(); // (Partie 2)
      const visible = [...dataGeojson, ...datamGeojson].filter(f => isFeatureInActiveZones(f) && !f.properties.isDiscourse);
      patterns = identifyPatterns(visible);
      refreshPatternsMap();   // (Partie 2)
    }
  });
});


/*---------------------------------------
  9) BITMASKS CRITÈRES (perf + utils)
---------------------------------------*/
let patternCounter = 1; // (NOTE: non utilisé directement ici; conservé)

/***************************************************
 * 1) LISTE DES CLÉS FUZZY (dans l’ordre fixe)
 ***************************************************/
const ALL_FUZZY_KEYS = [
  // Pratiques actives
  "PA_P1_intensitesoin",
  "PA_P1_frequencegestes",
  "PA_P1_degrecooperation",

  "PA_P2_degretransformation",
  "PA_P2_perrenite",
  "PA_P2_autonomie",

  "PA_P3_intensiteusage",
  "PA_P3_frequenceusage",
  "PA_P3_diversitepublic",
  "PA_P3_conflitusage",

  // Dynamiques hybrides
  "DH_P1_degreinformalite",
  "DH_P1_echellepratique",
  "DH_P1_degremutualisation",

  "DH_P2_degréorganisation",
  "DH_P2_porteepolitique",
  "DH_P2_effetspatial",

  "DH_P3_attachement",

  "DH_P4_intensiteflux",

  // Forces structurantes
  "FS_P1_presenceinstitutionnelle",
  "FS_P1_intensitecontrole",
  "FS_P2_abandon",
  "FS_P3_pressionfonciere"
];

let ACTIVE_FUZZY_KEYS = new Set(ALL_FUZZY_KEYS); // par défaut : tout est actif



/***************************************************
 * 2) PARSEUR FUZZY
 ***************************************************/
function parseFuzzy(v) {
  if (
    v === "-" ||
    v === "" ||
    v === null ||
    v === undefined ||
    v === "null" ||
    v === "NaN"
  ) return null;

  const num = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}


/***************************************************
 * 3) CONVERTIR UN FRAGMENT EN VECTEUR FUZZY
 ***************************************************/
function hasAnyActiveCriterion(feature) {
  if (!feature || !feature.properties) return false;
  // On regarde uniquement les critères encore "actifs"
  for (const k of ALL_FUZZY_KEYS) {
    if (!ACTIVE_FUZZY_KEYS.has(k)) continue;
    if (parseFuzzy(feature.properties[k]) !== null) {
      return true;
    }
  }
  return false;
}


function featureToVector(feature) {
  const props = feature.properties;

  return ALL_FUZZY_KEYS.map(k => {
    if (!ACTIVE_FUZZY_KEYS.has(k)) return null; // critère désactivé
    return parseFuzzy(props[k]);
  });
}


/***************************************************
 * 4) SIMILARITÉ FUZZY
 * Retourne un score entre 0 et 1
 ***************************************************/
function similarityFuzzy(vec1, vec2) {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < vec1.length; i++) {
    const a = vec1[i];
    const b = vec2[i];

    // aucun renseignement → on ignore ce critère
    if (a === null && b === null) continue;

    let dist;
    if (a === null || b === null) {
      dist = 1; // absence = pénalité max
    } else {
      dist = Math.abs(a - b);
    }

    sum += dist;
    count++;
  }

  if (count === 0) return 0; // aucun critère exploitable

  const avgDist = sum / count;
  return 1 - avgDist;
}

/***************************************************
 * 5) IDENTIFICATION DES PATTERNS FUZZY
 ***************************************************/
let SIM_THRESHOLD = 0.75;

function identifyPatterns(features) {
  const vecs = features.map(f => ({
    id: f.properties.id,
    f,
    vec: featureToVector(f)
  }));

  const used = new Set();
  const groups = [];
  let index = 1;

  for (let i = 0; i < vecs.length; i++) {
    if (used.has(vecs[i].id)) continue;

    for (let j = i + 1; j < vecs.length; j++) {
      if (used.has(vecs[j].id)) continue;

      const sim = similarityFuzzy(vecs[i].vec, vecs[j].vec);
      if (sim < SIM_THRESHOLD) continue;

      // Nouveau pattern
      const group = {
        name: `P${index++}`,
        elements: [vecs[i].id, vecs[j].id],
        coreSimilarity: sim
      };

      // Extension possible
      for (let k = 0; k < vecs.length; k++) {
        const idk = vecs[k].id;
        if (group.elements.includes(idk)) continue;

        const simk = similarityFuzzy(vecs[i].vec, vecs[k].vec);
        if (simk >= SIM_THRESHOLD) group.elements.push(idk);
      }

      group.elements.forEach(id => used.add(id));
      groups.push(group);
    }
  }

  // Format final : dictionnaire
  const result = {};
  groups.forEach(g => {
    result[g.name] = g;
  });
  return result;
}

/***************************************************
 * 6) SIGNATURE FUZZY D’UN FRAGMENT
 ***************************************************/
function fuzzySignature(vec) {
  let sum = 0;
  let count = 0;

  for (const v of vec) {
    if (v === null) continue;
    sum += v;
    count++;
  }

  if (count === 0) return 0;
  return sum / count;
}

/***************************************************
 * 8) AFFICHAGE DES CRITÈRES DANS LES PANELS
 ***************************************************/
function renderFuzzyCriteria(panel, feature) {
  const props = feature.properties;

  const container = document.createElement('div');
  container.className = "fuzzy-criteria";

  ALL_FUZZY_KEYS.forEach(k => {
    const raw = props[k];
    const val = parseFuzzy(raw);

    const line = document.createElement('div');
    line.className = 'crit-line';

    const label = document.createElement('span');
    label.className = 'crit-label';
    label.textContent = k;

    const value = document.createElement('span');
    value.className = 'crit-value';
    value.textContent = (val !== null ? val : "—");

    line.appendChild(label);
    line.appendChild(value);
    container.appendChild(line);
  });

  panel.appendChild(container);
}

function recomputePatternsAndRefreshViews() {
  // Recalcule la liste des features visibles selon la vue
  const visible = [...(dataGeojson || []), ...(datamGeojson || [])]
    .filter(f => isFeatureInActiveZones ? isFeatureInActiveZones(f) : true)
    .filter(f => !f.properties?.isDiscourse);

  patterns = identifyPatterns(visible);


}

/*---------------------------------------
 11) CHARGEMENT DES DONNÉES GEOJSON
---------------------------------------*/
// Contours (non interactifs)
fetch('data/contour.geojson')
  .then(r => r.json())
  .then(data => {
    L.geoJSON(data, {
      style: { color:'#919090', weight:2, opacity:0.8, fillOpacity:0 },
      interactive: false
    }).addTo(map);
  });

// Fragments Montreuil + Mirail
Promise.all([
  fetch('data/data.geojson').then(r => r.json()),
  fetch('data/datam.geojson').then(r => r.json())
]).then(([data, dataM]) => {
  dataGeojson  = data.features;
  datamGeojson = dataM.features;

  // Montreuil
  L.geoJSON({ type:'FeatureCollection', features: dataGeojson }, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 4, color: 'red', weight: 1, opacity: 1, fillColor: 'red', fillOpacity: 0.8
    }),
    style: () => ({ color:'red', weight:0.9, fillOpacity:0.3 }),
    onEachFeature: (feature, layer) => {
      feature.properties.zone = 'montreuil';
      layer.zone = 'montreuil';
      allLayers.push(layer);
      layer.on('click', () => showDetails(feature.properties));
    }
  }).addTo(map);

  // Mirail
  L.geoJSON({ type:'FeatureCollection', features: datamGeojson }, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 4, color: 'blue', weight: 1, opacity: 1, fillColor: 'blue', fillOpacity: 0.8
    }),
    style: () => ({ color:'blue', weight:0.9, fillOpacity:0.3 }),
    onEachFeature: (feature, layer) => {
      feature.properties.zone = 'mirail';
      layer.zone = 'mirail';
      allLayers.push(layer);
      layer.on('click', () => showDetails(feature.properties));
    }
  }).addTo(map);

  // Calcul initial des patterns (toutes zones)
  const allSpatialFeatures = [...dataGeojson, ...datamGeojson].filter(f => !f.properties.isDiscourse);
  patterns = identifyPatterns(allSpatialFeatures);
  patternsVersion++;
  combinedFeatures = [...dataGeojson, ...datamGeojson];

  // Si la carte patterns est déjà affichée, force un 1er rendu (Partie 2)
  if (currentView === 'patterns-map') {
    initPatternMapOnce();
    renderPatternBaseGrey();
    refreshPatternsMap();
  }
});

// Discours (pane dédié + grande zone cliquable transparente)
fetch('data/discours.geojson')
  .then(res => res.json())
  .then(data => {
    discoursLayer = L.geoJSON(data, {
      pane: 'pane-discours',
      pointToLayer: (feature, latlng) => {
        const visible = L.circleMarker(latlng, {
          radius: 5, fillColor: 'white', color: 'white', weight: 1, opacity: 1, fillOpacity: 0.8, pane: 'pane-discours'
        });
        const clickableArea = L.circle(latlng, {
          radius: 30, color: 'transparent', fillColor: 'transparent', weight: 0, fillOpacity: 0, pane: 'pane-discours'
        });
        clickableArea.on('click', () => showDetails(feature.properties));
        visible.on('click', () => showDetails(feature.properties));
        return L.layerGroup([clickableArea, visible]);
      },
      onEachFeature: (feature, layerGroup) => {
        allLayers.push(layerGroup);
        layerGroup.feature = feature;
      }
    });

    discoursLayer.addTo(map);
    applyFilters(); // pour respecter l’état des checkboxes
  });


/*==================================================
=                SIDEBAR À ONGLETS                 =
==================================================*/
const Tabbed = {
  el: null, tabsBar: null, content: null,
  openTabs: new Map(),     // id -> {btn, panel, kind}
  activeId: null
};

function ensureTabbedSidebar() {
  if (Tabbed.el) return;
  Tabbed.el      = document.getElementById('tabbed-sidebar');
  Tabbed.tabsBar = document.getElementById('tabbed-sidebar-tabs');
  Tabbed.content = document.getElementById('tabbed-sidebar-content');
}

function showTabbedSidebar() {
  ensureTabbedSidebar();
  Tabbed.el.style.display = 'block';
}
function hideTabbedSidebarIfEmpty() {
  if (Tabbed.openTabs.size === 0) {
    Tabbed.el.style.display = 'none';
    Tabbed.activeId = null;
  }
}

function clearAllTabbedTabs() {
  ensureTabbedSidebar();
  Array.from(Tabbed.openTabs.keys()).forEach(id => closeTab(id));
  Tabbed.tabsBar.innerHTML = '';
  Tabbed.content.innerHTML = '';
  Tabbed.activeId = null;
  Tabbed.el.style.display = 'none';
}

function focusTab(id) {
  if (!Tabbed.openTabs.has(id)) return;
  Tabbed.activeId = id;
  Tabbed.openTabs.forEach((rec, key) => {
    rec.btn.style.background = (key === id) ? '#222' : '#000';
    rec.btn.style.color      = '#fff';
    rec.panel.style.display  = (key === id) ? 'block' : 'none';
  });
}

function closeTab(id) {
  const rec = Tabbed.openTabs.get(id);
  if (!rec) return;
  rec.btn.remove();
  rec.panel.remove();
  Tabbed.openTabs.delete(id);
  if (Tabbed.activeId === id) {
    const last = Array.from(Tabbed.openTabs.keys()).pop();
    if (last) focusTab(last);
  }
  hideTabbedSidebarIfEmpty();
}

function makeTabButton(title, id) {
  const btn = document.createElement('button');
  btn.textContent = title;
  btn.title = title;
  btn.style.cssText = 'border:1px solid #333; background:#000; color:#fff; padding:6px 8px; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:6px; border-radius:4px;';
  btn.addEventListener('click', () => focusTab(id));

  const x = document.createElement('span');
  x.textContent = '×';
  x.style.cssText = 'display:inline-block; padding:0 4px; border-left:1px solid #333; cursor:pointer; opacity:.85;';
  x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  btn.appendChild(x);

  return btn;
}

function makePanelContainer(id) {
  const panel = document.createElement('div');
  panel.id = `panel-${id}`;
  panel.style.display = 'none';
  return panel;
}

function openTab({ id, title, kind, render }) {
  ensureTabbedSidebar();

  // Si onglet déjà ouvert → focus et sortir
  if (Tabbed.openTabs.has(id)) {
    focusTab(id);
    Tabbed.content.scrollTop = 0;
    return;
  }

  // Bouton onglet
  const btn   = makeTabButton(title, id);
  // Contenu
  const panel = makePanelContainer(id);

  // Injection dans le DOM
  Tabbed.tabsBar.appendChild(btn);
  Tabbed.content.appendChild(panel);

  // Rendu
  render(panel);

  // Enregistrement
  Tabbed.openTabs.set(id, { btn, panel, kind });

  // Afficher la sidebar si cachée
  showTabbedSidebar();

  // Focus sur l’onglet
  focusTab(id);
  Tabbed.content.scrollTop = 0;
}




/*==================================================
=    MÉTADONNÉES LOCALES PAR FRAGMENT (usage+discours) (texte)      =
==================================================*/
function getFragMetaKey(id){ return `fragmeta:${id}`; }
function loadFragmentMeta(fragmentId) {
  try {
    return JSON.parse(localStorage.getItem(getFragMetaKey(fragmentId)) || 'null') || { usages: [], discours: [] };
  } catch(e) { return { usages: [], discours: [] }; }
}
function saveFragmentMeta(fragmentId, meta) {
  localStorage.setItem(getFragMetaKey(fragmentId), JSON.stringify(meta));
  window.dispatchEvent(new CustomEvent('fragmeta:updated', { detail: { fragmentId, meta } }));
}
function uid(){ return Math.random().toString(36).slice(2,9); }


/***************************************************
=                PANNEAU FRAGMENT (Fuzzy + Usages) =
***************************************************/
function renderFragmentPanel(panel, props) {
  panel.innerHTML = '';

  const fragId = props.id || '—';

  /* ------------------------------
     En-tête du fragment
  ------------------------------ */
  const h2 = document.createElement('h2');
  h2.textContent = props.name || fragId || 'Fragment';

  const pId = document.createElement('p');
  pId.innerHTML = `<strong>ID :</strong> ${fragId}`;

  const pDesc = document.createElement('p');
  pDesc.textContent = props.description || '';

  /* ------------------------------
     Photos
  ------------------------------ */
  const photos = document.createElement('div');
  const photoList = normalizePhotos(props.photos);
  if (photoList.length) {
    photoList.forEach(src => {
      const img = makeImg(src, props.name || fragId || 'photo');
      if (img) {
        img.style.width = '100%';
        img.style.marginBottom = '8px';
        photos.appendChild(img);
      }
    });
  }

  panel.append(h2, pId, pDesc, photos);

  /* ------------------------------
     Boutons 3D
  ------------------------------ */
  const actions = document.createElement('div');
  actions.className = 'btn-row';

  const btnOpen3D = document.createElement('button');
  btnOpen3D.className = 'tab-btn btn-sm primary';
  btnOpen3D.textContent = hasFragment3D(fragId) ? 'Voir la 3D' : 'Importer 3D';
  btnOpen3D.addEventListener('click', () => openThreeModalForFragment(fragId));
  actions.append(btnOpen3D);

  if (hasFragment3D(fragId)) {
    const btnImport3D = document.createElement('button');
    btnImport3D.className = 'tab-btn btn-sm';
    btnImport3D.textContent = 'Remplacer 3D';
    btnImport3D.addEventListener('click', () => promptImport3DForFragment(fragId, true));
    actions.append(btnImport3D);
  }

  panel.append(actions);

  /* ======================================================
     1) USAGES issus du GeoJSON (parser la string en liste)
     ====================================================== */
  const existingUsages = [];
  if (props.usages && typeof props.usages === "string") {
    props.usages.split(/[;,]/).forEach(u => {
      const trimmed = u.trim();
      if (trimmed && trimmed !== "-") existingUsages.push(trimmed);
    });
  }

  const blockExisting = document.createElement('div');
  blockExisting.className = 'meta-box';

  const headExist = document.createElement('div');
  headExist.className = 'meta-head';
  headExist.innerHTML = `<strong>Usages issus du terrain</strong>`;
  blockExisting.appendChild(headExist);

  const listExist = document.createElement('div');
  listExist.className = 'meta-list';

  if (existingUsages.length) {
    existingUsages.forEach(u => {
      const row = document.createElement('div');
      row.className = 'meta-item';
      row.innerHTML = `<div class="meta-item-text">${u}</div>`;
      listExist.appendChild(row);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'meta-empty';
    empty.textContent = "— Aucun usage renseigné dans le GeoJSON.";
    listExist.appendChild(empty);
  }

  blockExisting.appendChild(listExist);
  panel.append(blockExisting);

  /* ======================================================
     2) USAGES ajoutés localement par l’utilisateur
     ====================================================== */
  const meta = loadFragmentMeta(fragId);

  function makeEditorBlock(title, listKey, placeholder) {
    const box = document.createElement('div');
    box.className = 'meta-box';

    const head = document.createElement('div');
    head.className = 'meta-head';
    head.innerHTML = `<strong>${title}</strong>`;
    box.appendChild(head);

    const addRow = document.createElement('div');
    addRow.className = 'meta-add-row';

    const ta = document.createElement('textarea');
    ta.className = 'meta-ta';
    ta.rows = 3;
    ta.placeholder = placeholder;

    const addBtn = document.createElement('button');
    addBtn.className = 'tab-btn btn-sm';
    addBtn.textContent = 'Ajouter';

    addBtn.addEventListener('click', () => {
      const txt = ta.value.trim();
      if (!txt) return;
      meta[listKey].push({ id: uid(), text: txt });
      saveFragmentMeta(fragId, meta);
      ta.value = '';
      renderList();
    });

    addRow.append(ta, addBtn);
    box.appendChild(addRow);

    const list = document.createElement('div');
    list.className = 'meta-list';
    box.appendChild(list);

    function renderList() {
      list.innerHTML = '';
      meta[listKey].forEach(item => {
        const row = document.createElement('div');
        row.className = 'meta-item';

        const left = document.createElement('div');
        left.className = 'meta-item-left';

        const txt = document.createElement('div');
        txt.className = 'meta-item-text';
        txt.textContent = item.text;
        txt.title = 'Cliquer pour éditer';

        // Édition
        txt.addEventListener('click', () => {
          if (row.querySelector('textarea')) return;
          const editor = document.createElement('textarea');
          editor.className = 'meta-edit';
          editor.value = item.text;

          const saveBtn = document.createElement('button');
          saveBtn.className = 'tab-btn btn-xs primary';
          saveBtn.textContent = 'OK';

          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'tab-btn btn-xs';
          cancelBtn.textContent = 'Annuler';

          const editRow = document.createElement('div');
          editRow.className = 'meta-edit-row';
          editRow.append(editor, saveBtn, cancelBtn);

          left.replaceChild(editRow, txt);

          saveBtn.addEventListener('click', () => {
            const newTxt = editor.value.trim();
            if (newTxt) {
              item.text = newTxt;
              saveFragmentMeta(fragId, meta);
            }
            renderList();
          });

          cancelBtn.addEventListener('click', renderList);
        });

        left.appendChild(txt);

        const right = document.createElement('div');
        right.className = 'meta-item-right';

        const delBtn = document.createElement('button');
        delBtn.className = 'tab-btn btn-xs danger';
        delBtn.textContent = 'Suppr.';

        delBtn.addEventListener('click', () => {
          meta[listKey] = meta[listKey].filter(x => x.id !== item.id);
          saveFragmentMeta(fragId, meta);
          renderList();
        });

        right.appendChild(delBtn);

        row.append(left, right);
        list.appendChild(row);
      });

      if (!meta[listKey].length) {
        const empty = document.createElement('div');
        empty.className = 'meta-empty';
        empty.textContent = '— Aucun élément pour le moment.';
        list.appendChild(empty);
      }
    }

    renderList();
    return box;
  }

  const usagesBlock = makeEditorBlock('Usages ajoutés', 'usages', 'Ex : « Lieu de réunion… »');
  const discoursBlock = makeEditorBlock('Discours', 'discours', 'Ex : « L’institution prévoit… »');

  panel.append(usagesBlock, discoursBlock);

  /* ======================================================
     3) CRITÈRES FUZZY
     ====================================================== */
  const fuzzyBlock = document.createElement('div');
  fuzzyBlock.className = 'fuzzy-criteria';

  const hFuzzy = document.createElement('h3');
  hFuzzy.textContent = "Critères";
  fuzzyBlock.appendChild(hFuzzy);

  ALL_FUZZY_KEYS.forEach(k => {
    const raw = props[k];
    const val = parseFuzzy(raw);

    const row = document.createElement('div');
    row.className = 'crit-line';

    const label = document.createElement('span');
    label.className = 'crit-label';
    label.textContent = k;

    const value = document.createElement('span');
    value.className = 'crit-value';
    value.textContent = (val !== null ? val : "—");

    row.append(label, value);
    fuzzyBlock.appendChild(row);
  });

  panel.append(fuzzyBlock);
}


/***************************************************
=        PANNEAU PATTERN     =
***************************************************/

/***************************************************
 * Similarité d'un fragment par rapport à son pattern
 * - fragmentId : ID du fragment (ex: "M001")
 * - patternKey : clé du pattern (ex: "P1")
 * - byIdMap    : Map(id -> feature) déjà construite dans renderPatternPanel
 * Retourne un score entre 0 et 1 (comme similarityFuzzy)
 ***************************************************/
function computeFragmentPatternSimilarity(fragmentId, patternKey, byIdMap) {
  const pattern = (patterns && patterns[patternKey]) ? patterns[patternKey] : null;
  if (!pattern) return 0;

  const members = (pattern.elements || []).filter(id => id !== fragmentId);
  const frag    = byIdMap.get(fragmentId);
  if (!frag) return 0;

  const vFrag = featureToVector(frag);

  // Pattern composé d'un seul fragment → similarité maximale par convention
  if (!members.length) return 1;

  let sum = 0;
  let count = 0;

  members.forEach(id => {
    const f = byIdMap.get(id);
    if (!f) return;
    const v = featureToVector(f);
    sum += similarityFuzzy(vFrag, v);
    count++;
  });

  return count ? (sum / count) : 0;
}


function renderPatternPanel(panel, patternKey, patternData) {
  panel.innerHTML = '';

  const ids = patternData.elements || [];
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map(f => [f.properties.id, f]));

  /* --------------------------------------------
     1) Titre
  -------------------------------------------- */
  const h2 = document.createElement('h2');
  h2.textContent = `${patternKey} — Pattern`;
  panel.appendChild(h2);

  /* --------------------------------------------
     2) Similarité moyenne globale
  -------------------------------------------- */
  const vecs = ids.map(id => featureToVector(byId.get(id)));
  let simSum = 0, simCount = 0;

  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      simSum += similarityFuzzy(vecs[i], vecs[j]);
      simCount++;
    }
  }

  const avgSim = simCount ? simSum / simCount : 0;

  const pMeta = document.createElement('p');
  pMeta.className = 'pattern-meta';
  pMeta.textContent = `${ids.length} fragments — similarité moyenne : ${avgSim.toFixed(2)}`;
  panel.appendChild(pMeta);

  /* --------------------------------------------
     3) CRITÈRES COMMUNS (moyenne fuzzy)
  -------------------------------------------- */
  const consens = computeFuzzySignatureForIds(ids);


  // On garde seulement les critères “significatifs”
  const keysShown = Object.entries(consens)
    .filter(([k, v]) => v !== null && v >= 0.2)
    .sort((a, b) => b[1] - a[1]); // tri par importance

  const critBlock = document.createElement('div');
  critBlock.className = 'pattern-crit-block';

  const hCrit = document.createElement('h3');
  hCrit.textContent = 'Pourcentage de similarité du groupe';
  critBlock.appendChild(hCrit);

  if (!keysShown.length) {
    const none = document.createElement('p');
    none.textContent = 'Aucun critère commun significatif.';
    none.style.color = '#aaa';
    critBlock.appendChild(none);
  } else {
    keysShown.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'crit-row';

      const label = document.createElement('span');
      label.className = 'crit-label';
      label.textContent = k.replace(/_/g, ' ');

      const val = document.createElement('span');
      val.className = 'crit-value';
      val.textContent = v.toFixed(2);

      row.append(label, val);
      critBlock.appendChild(row);
    });
  }

  panel.appendChild(critBlock);

  /* --------------------------------------------
     4) Liste des membres
  -------------------------------------------- */
  const list = document.createElement('div');
  list.className = 'pattern-members';

  const hList = document.createElement('h3');
  hList.textContent = 'Fragments du pattern';
  list.appendChild(hList);

  ids.forEach(id => {
    const f = byId.get(id);
    if (!f) return;

    const row = document.createElement('div');
    row.className = 'member-row';

    // photo
    const thumb = document.createElement('div');
    thumb.className = 'member-thumb';
    const photoUrl = normalizePhotos(f.properties.photos)[0];
    if (photoUrl) thumb.style.backgroundImage = `url("${photoUrl}")`;

    // titre
    const right = document.createElement('div');
    right.className = 'member-right';

    const title = document.createElement('div');
    title.className = 'member-title';
    title.textContent = f.properties.name || id;

    // similarité du fragment au cluster
    const simToPattern = computeFragmentPatternSimilarity(id, patternKey, byId);

    const info = document.createElement('div');
    info.className = 'member-info';
    info.innerHTML = `<strong>Proximité :</strong> ${simToPattern.toFixed(2)}`;

    right.append(title, info);
    row.append(thumb, right);

    row.addEventListener('click', () => showDetails(f.properties));
    list.appendChild(row);
  });

  panel.appendChild(list);

  /* --------------------------------------------
     5) Actions
  -------------------------------------------- */
  const actions = document.createElement('div');
  actions.className = 'btn-row';

  const btnSave = document.createElement('button');
  btnSave.className = 'tab-btn btn-sm primary';
  btnSave.textContent = 'Enregistrer ce pattern';
  btnSave.onclick = () => openSavePatternModal(patternKey, patternData);

  actions.appendChild(btnSave);
  panel.appendChild(actions);
}



/*==================================================
=                PANNEAU DISCOURS                  =
==================================================*/
function renderDiscoursePanel(panel, props) {
  panel.innerHTML = '';
  const h2 = document.createElement('h2'); h2.textContent = props.id || 'Discours';
  const pA = document.createElement('p'); pA.innerHTML = `<strong>Auteur :</strong> ${props.auteur || ''}`;
  const pD = document.createElement('p'); pD.innerHTML = `<strong>Date :</strong> ${props.date || ''}`;
  const pS = document.createElement('p');
  const src = props.source || '';
  pS.innerHTML = `<strong>Source :</strong> ${ src && String(src).startsWith('http') ? `<a href="${src}" target="_blank">${src}</a>` : src }`;
  const pT = document.createElement('p'); pT.textContent = props.contenu || '';
  panel.append(h2, pA, pD, pS, pT);
}


/***************************************************
=                  VUE GALERIE (FUZZY)             =
***************************************************/
function showGalleryView() {
  const gallery = document.getElementById('gallery-view');
  gallery.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'gallery-wrapper';
  gallery.appendChild(wrapper);

  const allFeatures = [...(dataGeojson || []), ...(datamGeojson || [])];

  const patternsEntries = Object.entries(patterns || {});
  if (!patternsEntries.length) {
    const msg = document.createElement('div');
    msg.style.color = '#aaa';
    msg.style.padding = '10px';
    msg.textContent = "Aucun pattern trouvé avec le seuil de similarité actuel.";
    gallery.appendChild(msg);
    return;
  }

  patternsEntries.forEach(([key, pattern]) => {
    const block = document.createElement('section');
    block.className = 'pattern-block';

    const title = document.createElement('h3');
    title.className = 'pattern-title';

    // ---- calcul similarité moyenne du pattern ----
    const ids = pattern.elements || [];
    const vecs = ids.map(id => {
      const f = allFeatures.find(x => x.properties.id === id);
      return f ? featureToVector(f) : null;
    }).filter(v => v !== null);

    let acc = 0, count = 0;
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        acc += similarityFuzzy(vecs[i], vecs[j]);
        count++;
      }
    }
    const avgSim = count ? (acc / count) : 0;

    title.textContent = `${key} — ${ids.length} fragments — similarité moyenne ${avgSim.toFixed(2)}`;

    const grid = document.createElement('div');
    grid.className = 'photo-grid';

    ids.forEach(id => {
      const feature = allFeatures.find(f => f.properties.id === id);
      if (!feature) return;

      const fragName = feature.properties.name || id || 'Fragment';
      const photosRaw = normalizePhotos(feature.properties.photos);
      const photos = photosRaw.filter(Boolean); // enlève les "" éventuels

      // Si le fragment a au moins une photo exploitable
      if (photos.length) {
        photos.forEach(photo => {
          const cell = document.createElement('div');
          cell.className = 'photo-cell';

          const img = makeImg(photo, fragName);
          if (img) {
            img.onclick = () => showDetails(feature.properties);
            cell.appendChild(img);
          } else {
            // URL invalide → carré gris
            cell.classList.add('no-photo');
            cell.style.background = '#444';
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.style.color = '#ddd';
            cell.style.fontSize = '11px';
            cell.style.cursor = 'pointer';

            const label = document.createElement('div');
            label.textContent = feature.properties.id || '—';
            cell.appendChild(label);

            cell.onclick = () => showDetails(feature.properties);
          }

          grid.appendChild(cell);
        });
      } else {
        // AUCUNE photo -> un seul carré gris par fragment
        const cell = document.createElement('div');
        cell.className = 'photo-cell no-photo';
        cell.style.background = '#444';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.color = '#ddd';
        cell.style.fontSize = '11px';
        cell.style.cursor = 'pointer';

        const label = document.createElement('div');
        label.innerHTML = `<strong>${feature.properties.id || '—'}</strong><br>${fragName}`;
        label.style.textAlign = 'center';

        cell.appendChild(label);
        cell.onclick = () => showDetails(feature.properties);

        grid.appendChild(cell);
      }
    });

    block.append(title, grid);
    wrapper.appendChild(block);
  });
}




/*==================================================
=                  VUE PROXÉMIQUE                  =
==================================================*/
const FUZZY_GROUPS = {
  PA: [
    "PA_P1_intensitesoin","PA_P1_frequencegestes","PA_P1_degrecooperation",
    "PA_P2_degretransformation","PA_P2_perrenite","PA_P2_autonomie",
    "PA_P3_intensiteusage","PA_P3_frequenceusage","PA_P3_diversitepublic","PA_P3_conflitusage"
  ],
  DH: [
    "DH_P1_degreinformalite","DH_P1_echellepratique","DH_P1_degremutualisation",
    "DH_P2_degréorganisation","DH_P2_porteepolitique","DH_P2_effetspatial",
    "DH_P3_attachement","DH_P4_intensiteflux"
  ],
  FS: [
    "FS_P1_presenceinstitutionnelle","FS_P1_intensitecontrole",
    "FS_P2_abandon","FS_P3_pressionfonciere"
  ]
};

function computeGroupScore(ids, groupKeys) {
  const all = [...dataGeojson, ...datamGeojson];

  let sum = 0, count = 0;

  ids.forEach(id => {
    const f = all.find(x => x.properties.id === id);
    groupKeys.forEach(k => {
      const v = parseFuzzy(f.properties[k]);
      if (v !== null) {
        sum += v;
        count++;
      }
    });
  });

  return count ? (sum / count) : 0;
}


/***************************************************
 *  PROXÉMIE 2025 — Concentrique, Fuzzy, Interactive
 *  - Disparition si : zone décochée OU aucun critère actif
 *  - 3 anneaux : PA (intérieur) • DH (médian) • FS (extérieur)
 *  - Patterns = anneaux colorés
 *  - Pan / zoom infini
 ***************************************************/

// Ouvre l’onglet fragment + tous ses patterns associés
function openFragmentWithPatternsTabs(fProps) {
  if (!fProps) return;

  clearAllTabbedTabs();
  closeSidebars();

  const fragId = fProps.id || Math.random().toString(36).slice(2);
  const fragTabId = `frag-${fragId}`;

  // 1) Onglet fragment
  openTab({
    id: fragTabId,
    title: fProps.id || 'Fragment',
    kind: 'fragment',
    render: (panel) => renderFragmentPanel(panel, fProps)
  });

  // 2) Onglets patterns associés
  const pList = getPatternsForFragment(fragId);
  pList.forEach(pName => {
    const pData = patterns[pName];
    if (!pData) return;
    openTab({
      id: `pattern-${pName}`,
      title: pName,
      kind: 'pattern',
      render: (panel) => renderPatternPanel(panel, pName, pData)
    });
  });

  // 3) On remet le focus sur le fragment
  focusTab(fragTabId);
}


function showProxemicView() {

  /* -----------------------------------------------------------
   * 0) RESET + DIMENSIONS
   * ----------------------------------------------------------- */
  proxemicView.innerHTML = "";

  const rect = proxemicView.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  // Centre visuel légèrement abaissé
  const CX = W * 0.50;
  const CY = H * 0.53;

  // On agrandit volontairement le camembert
  const R_BASE  = Math.min(W, H) * 0.42;
  const R_INNER = R_BASE * 0.15;
  const R_OUTER = R_BASE * 0.95;

  const TWO_PI = Math.PI * 2;

  /* -----------------------------------------------------------
   * 1) DÉFINITION STRUCTURELLE DES PÔLES + CLÉS FUZZY
   * ----------------------------------------------------------- */
  const GROUP_DETAILS = {
    PA: {
      entretien: [
        "PA_P1_intensitesoin", "PA_P1_frequencegestes", "PA_P1_degrecooperation"
      ],
      appr_spatiale: [
        "PA_P2_degretransformation", "PA_P2_perrenite", "PA_P2_autonomie"
      ],
      appr_sociale: [
        "PA_P3_intensiteusage", "PA_P3_frequenceusage",
        "PA_P3_diversitepublic", "PA_P3_conflitusage"
      ]
    },
    DH: {
      econ_subs: [
        "DH_P1_degreinformalite", "DH_P1_echellepratique", "DH_P1_degremutualisation"
      ],
      contest: [
        "DH_P2_degréorganisation", "DH_P2_porteepolitique", "DH_P2_effetspatial"
      ],
      symbolique: [
        "DH_P3_attachement"
      ],
      mobilites: [
        "DH_P4_intensiteflux"
      ]
    },
    FS: {
      gouvernance: [
        "FS_P1_presenceinstitutionnelle", "FS_P1_intensitecontrole"
      ],
      vacance: [
        "FS_P2_abandon"
      ],
      marche: [
        "FS_P3_pressionfonciere"
      ]
    }
  };

  const SUB_ORDER = {
    PA: ["entretien", "appr_spatiale", "appr_sociale"],
    DH: ["econ_subs", "contest", "symbolique", "mobilites"],
    FS: ["gouvernance", "vacance", "marche"]
  };

  const SUB_LABELS = {
    entretien:     "Entretien / care",
    appr_spatiale: "Appropriation spatiale",
    appr_sociale:  "Appropriation sociale",
    econ_subs:     "Éco. de subsistance",
    contest:       "Contestation / militantisme",
    symbolique:    "Symbolique",
    mobilites:     "Mobilités",
    gouvernance:   "Cadres de gouvernance",
    vacance:       "Vacance",
    marche:        "Économie de marché"
  };

  const SECTORS = {
    PA: {
      start: -Math.PI/2,
      end:   -Math.PI/2 + TWO_PI/3
    },
    FS: {
      start: -Math.PI/2 + TWO_PI/3,
      end:   -Math.PI/2 + 2*TWO_PI/3
    },
    DH: {
      start: -Math.PI/2 + 2*TWO_PI/3,
      end:   -Math.PI/2 + TWO_PI
    }
  };

  function poleCategory(sub) {
    if (SUB_ORDER.PA.includes(sub)) return "PA";
    if (SUB_ORDER.FS.includes(sub)) return "FS";
    if (SUB_ORDER.DH.includes(sub)) return "DH";
    return null;
  }

  function computeSubScores(feature) {
    const scores = {};
    for (const [zone, subs] of Object.entries(GROUP_DETAILS)) {
      for (const [subName, keys] of Object.entries(subs)) {
        let sum = 0, n = 0;
        for (const k of keys) {
          if (!ACTIVE_FUZZY_KEYS.has(k)) continue;
          const v = parseFuzzy(feature.properties[k]);
          if (v !== null) { sum += v; n++; }
        }
        scores[subName] = n ? (sum / n) : null;

      }
    }
    return scores;
  }

  function angleForSub(cat, sub) {
    const order = SUB_ORDER[cat];
    const idx   = order.indexOf(sub);

    if (idx === -1) {
      const s = SECTORS[cat].start, e = SECTORS[cat].end;
      return (s + e) / 2;
    }

    const s = SECTORS[cat].start;
    const e = SECTORS[cat].end;
    const slice = (e - s) / order.length;
    const subStart = s + idx * slice;
    const subEnd   = subStart + slice;

    return (subStart + subEnd) / 2;
  }

  function cleanId(id) {
    return id ? String(id).trim().toUpperCase() : "";
  }

  /* -----------------------------------------------------------
   * 2) SÉLECTION DES FRAGMENTS
   * ----------------------------------------------------------- */
  const raw = [...(dataGeojson||[]), ...(datamGeojson||[])];
  const zonesActive = getActiveZones ? getActiveZones() : ["mirail","montreuil"];

  let features = raw
    .filter(f => f.properties && f.properties.id)
    .filter(f => !f.properties.isDiscourse)
    .map(f => {
      f.properties.id = cleanId(f.properties.id);
      return f;
    });

  if (zonesActive.length) {
    features = features.filter(f => {
      const id = f.properties.id;
      if (id.startsWith("M")) return zonesActive.includes("mirail");
      if (id.startsWith("N")) return zonesActive.includes("montreuil");
      return true;
    });
  }

  features = features.filter(f => hasAnyActiveCriterion(f));

  if (!features.length) {
    proxemicView.innerHTML = "<div style='color:#aaa;padding:10px'>Aucun fragment.</div>";
    return;
  }

  /* -----------------------------------------------------------
   * 3) CALCUL : SOUS-PÔLE DOMINANT + RAYON
   * ----------------------------------------------------------- */
  const proxCandidates = [];
  let minScore = Infinity, maxScore = -Infinity;

  features.forEach(f => {
    const subScores = computeSubScores(f);

    let bestSub = null, bestScore = -Infinity;
Object.entries(subScores).forEach(([sub, val]) => {
  if (val !== null && val > bestScore) {
    bestScore = val;
    bestSub = sub;
  }
});

    if (!bestSub) return;

    const cat = poleCategory(bestSub);
    if (!cat) return;

    if (bestScore < minScore) minScore = bestScore;
    if (bestScore > maxScore) maxScore = bestScore;

    proxCandidates.push({
      id: f.properties.id,
      feature: f,
      bestSub,
      bestScore,
      category: cat,
      patterns: getPatternsForFragment ? getPatternsForFragment(f.properties.id) : []
    });
  });

  if (!proxCandidates.length) return;

  if (minScore === maxScore) minScore = maxScore - 1;

  /* -----------------------------------------------------------
   * 4) SVG + CALCUL POSITIONS INITIALES (PÔLAIRES)
   * ----------------------------------------------------------- */
  const svg = d3.select("#proxemic-view")
    .append("svg")
    .attr("width", W)
    .attr("height", H);

  const world      = svg.append("g");
  const slicesLayer = world.append("g");
  const linksLayer  = world.append("g");
  const nodesLayer  = world.append("g");
  const labelsLayer = world.append("g");

  svg.call(
    d3.zoom()
      .scaleExtent([0.4, 4])
      .on("zoom", ev => world.attr("transform", ev.transform))
  );

/* -----------------------------------------------------------
 * 5) ARCS DU CAMEMBERT (CORRIGÉ — ANNEAU + ROTATION PARFAITE)
 * ----------------------------------------------------------- */

// => correction clé : on dessine un DONUT, pas un disque plein
const arc = d3.arc()
  .innerRadius(0)   // idem fragments → parfaitement aligné
  .outerRadius(R_BASE);          // bord extérieur

const sectors = [
  { key:"PA", label:"Pratiques actives" },
  { key:"FS", label:"Forces structurantes" },
  { key:"DH", label:"Dynamiques hybrides" }
];

// 1) Secteurs = anneaux
slicesLayer.selectAll("path.sector")
  .data(sectors)
  .join("path")
  .attr("class","sector")
  .attr("d",d=>arc({
    startAngle: SECTORS[d.key].start + Math.PI/2,   //   correction
    endAngle:   SECTORS[d.key].end   + Math.PI/2    //   correction
  }))
  .attr("transform",`translate(${CX},${CY})`)
  .style("fill","none")
  .style("stroke","rgba(255,255,255,0.45)")
  .style("stroke-width",2);


// 2) Lignes radiales divisant le donut
sectors.forEach(s => {
  const cat = s.key;
  const list = SUB_ORDER[cat];
  if (!list) return;

  const slice = (SECTORS[cat].end - SECTORS[cat].start) / list.length;

  for (let i=1;i<list.length;i++){
    const ang = SECTORS[cat].start + i*slice;

    slicesLayer.append("line")
  .attr("x1", CX)
  .attr("y1", CY)
  .attr("x2", CX + R_BASE * Math.cos(ang))
  .attr("y2", CY + R_BASE * Math.sin(ang))
  .style("stroke", "rgba(255,255,255,0.25)")
  .style("stroke-width", 1);

  }
});


  /* -----------------------------------------------------------
   * 6) LABELS EXTÉRIEURS
   * ----------------------------------------------------------- */
  const R_LABEL = R_BASE * 1.12;

// grands pôles — orientés comme les rayons + éloignés + plus grands
const R_LABEL_MAIN = R_BASE * 1.32; // plus loin que les sub labels

sectors.forEach(s => {
  const ang = (SECTORS[s.key].start + SECTORS[s.key].end) / 2;

  const x = CX + R_LABEL_MAIN * Math.cos(ang);
  const y = CY + R_LABEL_MAIN * Math.sin(ang);

  let deg = (ang * 180 / Math.PI) + 90;
if (deg > 90 && deg < 270) deg += 180;


  labelsLayer.append("text")
    .attr("x", x)
    .attr("y", y)
    .attr("transform", `rotate(${deg}, ${x}, ${y})`)
    .text(s.label)
    .style("fill", "#fff")
    .style("font-size", "22px")     // plus grand
    .style("font-weight", "900")    // plus gras
    .style("text-anchor", "middle")
    .style("pointer-events", "none");
});


  // sous-pôles
  Object.entries(SUB_ORDER).forEach(([cat, subs])=>{
    subs.forEach(sub=>{
      const ang = angleForSub(cat, sub);
      const x = CX + R_LABEL*Math.cos(ang);
      const y = CY + R_LABEL*Math.sin(ang);

let deg = (ang * 180 / Math.PI) + 90;
if (deg > 90 && deg < 270) deg += 180;


labelsLayer.append("text")
  .attr("x", x)
  .attr("y", y)
  .attr("transform", `rotate(${deg}, ${x}, ${y})`)
  .text(SUB_LABELS[sub] || sub)
  .style("fill","#fff")
  .style("font-size","11px")
  .style("font-weight","600")
  .style("text-anchor","middle")
  .style("pointer-events","none");
    });
  });

  /* -----------------------------------------------------------
   * 7) POSITIONS INITIALES DES FRAGMENTS
   * ----------------------------------------------------------- */
  const proxData = proxCandidates.map(c=>{
    const n = (c.bestScore - minScore) / (maxScore - minScore || 1);
    const radius = R_INNER + n*(R_OUTER - R_INNER);
    const theta  = angleForSub(c.category, c.bestSub);

    const x = CX + radius*Math.cos(theta);
    const y = CY + radius*Math.sin(theta);

    return {
      ...c,
      id: c.id,
      x, y, r:radius, theta
    };
  });

  /* -----------------------------------------------------------
   * 8) ANTI-COLLISION (force layout)
   * ----------------------------------------------------------- */
  const sim = d3.forceSimulation(proxData)
    .force("x", d3.forceX(d=>d.x).strength(1))
    .force("y", d3.forceY(d=>d.y).strength(1))
    .force("collide", d3.forceCollide().radius(d => {
  const halfDiag = Math.sqrt( (26/2)**2 + (18/2)**2 );  // mettre les nouvelles dimensions !
return halfDiag + 1;
}))
    .stop();

  for (let i=0;i<200;i++) sim.tick();

  proxData.forEach(d=>{
    d.x = d.x + (d.vx||0);
    d.y = d.y + (d.vy||0);
  });


function getFragmentPhoto(f) {
  const photos = normalizePhotos(f.properties.photos);
  const url = cleanPhotoUrl(photos[0] || null);
  return url;
}

  /* -----------------------------------------------------------
   * 9) LIENS DE PATTERNS
   * ----------------------------------------------------------- */
  const meshLinks = [];
  for (let i=0;i<proxData.length;i++){
    for (let j=i+1;j<proxData.length;j++){
      const A = proxData[i], B = proxData[j];
      const common = A.patterns.filter(p=>B.patterns.includes(p));
      if (common.length){
        meshLinks.push({
          source:A, target:B,
          color: colorForPattern ? colorForPattern(common[0]) : "#888"
        });
      }
    }
  }

  linksLayer.selectAll("line.link")
    .data(meshLinks)
    .join("line")
    .attr("class","link")
    .attr("x1",d=>d.source.x)
    .attr("y1",d=>d.source.y)
    .attr("x2",d=>d.target.x)
    .attr("y2",d=>d.target.y)
    .style("stroke",d=>d.color)
    .style("stroke-width",2)
    .style("opacity",0.25);

  /* -----------------------------------------------------------
   * 10) NŒUDS (FRAGMENTS)
   * ----------------------------------------------------------- */
  const nodes = nodesLayer.selectAll("g.node")
    .data(proxData)
    .join("g")
    .attr("class","node")
    .attr("transform", d=>"translate("+d.x+","+d.y+")");

      // Helper : applique un scale aux nœuds
  function applyNodeScale(activeId, factor) {
    nodes.attr("transform", d => {
      const base = `translate(${d.x},${d.y})`;
      if (activeId && d.id === activeId) {
        return `${base} scale(${factor})`;   // fragment zoomé
      }
      return `${base} scale(1)`;            // taille normale
    });
  }


/* -------------------------------
 * REMPLACEMENT : vignette image
 * ------------------------------- */
nodes.each(function(d) {

  const g = d3.select(this);

  const photo = getFragmentPhoto(d.feature);

  // 1) Conteneur rectangulaire
  const rectW = 26;
  const rectH = 18;

  // rectangle de base (blanc si pas de photo)
  g.append("rect")
    .attr("x", -rectW/2)
    .attr("y", -rectH/2)
    .attr("width", rectW)
    .attr("height", rectH)
    .attr("rx", 0)
    .attr("ry", 0)
    .style("fill", photo ? "url(#img-" + d.id + ")" : "#444444ff")
    .style("cursor","pointer");

  // 2) Image en <pattern>
  if (photo) {
    svg.append("defs")
      .append("pattern")
      .attr("id", "img-"+d.id)
      .attr("patternUnits", "objectBoundingBox")
      .attr("width", 1)
      .attr("height", 1)
      .append("image")
      .attr("href", photo)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("width", rectW)
      .attr("height", rectH)
      .attr("x", 0)
      .attr("y", 0);
  }

  // 3) RECTANGLES DE PATTERN (au lieu des anneaux circulaires)
  if (d.patterns) {
    d.patterns.slice()
      .sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)))
      .forEach((p,i)=>{
        g.append("rect")
          .attr("x", -rectW/2 - (3 + i*3))
          .attr("y", -rectH/2 - (3 + i*3))
          .attr("width", rectW + 2*(3 + i*3))
          .attr("height", rectH + 2*(3 + i*3))
          .attr("rx", 0)
          .attr("ry", 0)
          .style("fill","none")
          .style("stroke", colorForPattern(p))
          .style("stroke-width",2)
          .style("pointer-events","none");
      });
  }

});

  /* -----------------------------------------------------------
   * 11) INTERACTIONS : HOVER / CLICK
   * ----------------------------------------------------------- */
  let selected = null;

    function highlight(id){
    // liens
    linksLayer.selectAll("line.link")
      .style("opacity", d => (d.source.id===id || d.target.id===id) ? 0.9 : 0.05);

    // nœuds connectés
    const connected = new Set([id]);
    meshLinks.forEach(L=>{
      if (L.source.id===id) connected.add(L.target.id);
      if (L.target.id===id) connected.add(L.source.id);
    });

    nodes.style("opacity", n => connected.has(n.id) ? 1 : 0.1);

    //   zoom ×3 sur le fragment ciblé
    applyNodeScale(id, 3);
  }


    function reset(){
    // si un fragment est sélectionné, on NE reset pas (le zoom reste)
    if (selected) return;

    nodes.style("opacity",1);
    linksLayer.selectAll("line.link")
      .style("opacity",0.25);

    //   remet toutes les vignettes à l’échelle 1
    applyNodeScale(null, 1);
  }


  nodes
    .on("mouseenter",function(ev,d){
      if (selected) return;
      highlight(d.id);
    })
    .on("mouseleave",function(){
      if (selected) return;
      reset();
    })
    .on("click",function(ev,d){
      ev.stopPropagation();   // << déplacé au niveau de G !
  if (selected===d.id){
    selected=null;
    reset();
  } else {
    selected=d.id;
    highlight(d.id);
  }
  openFragmentWithPatternsTabs(d.feature.properties);
});


  svg.on("click",(ev)=>{
  if (ev.target.closest('.node')) return; // ne reset pas si clic sur node
  selected=null;
  reset();
});
}






/*==================================================
=               GESTION DES VUES (UI)              =
==================================================*/
function setView(viewId) {
  currentView = viewId;
  const views = {
    map: document.getElementById('map'),
    proxemic: document.getElementById('proxemic-view'),
    gallery: document.getElementById('gallery-view'),
    critical: document.getElementById('critical-view'),
  };
  Object.entries(views).forEach(([key, el]) => { el.style.display = key === viewId ? 'block' : 'none'; });
  if (viewId === 'proxemic') showProxemicView();
  if (viewId === 'gallery')  showGalleryView();
  if (viewId === 'critical') showCriticalView();
  updateInterfaceElements(viewId);
}

function updateInterfaceElements(viewId) {
  const legendBtn   = document.getElementById('toggle-legend-btn');
  const locationBtn = document.getElementById('toggle-location-btn');
  

    document.querySelectorAll('.crit-key').forEach(cb => {
    // évite d'empiler les listeners à chaque changement de vue
    if (cb.__critKeyBound) return;
    cb.__critKeyBound = true;

    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      if (!key) return;

      if (cb.checked) ACTIVE_FUZZY_KEYS.add(key);
      else ACTIVE_FUZZY_KEYS.delete(key);

      // Recompute ↓↓↓
      applyFilters();
      recomputePatternsForPatternsMap?.();

      if (currentView === 'patterns-map') {
        renderPatternBaseGrey?.();
        refreshPatternsMap?.();
      }

      //   Si on est en vue de composition, on rafraîchit les sources
      if (currentView === 'gallery-compose' &&
          typeof window.__refreshGalleryComposeSources === 'function') {
        window.__refreshGalleryComposeSources();
      }
    });
  });



  // ✅ bouton "Critères actifs" visible sur : Carte (patterns-map), Proxémie, Galerie
  const wantsLegend =
    viewId === "proxemic" ||
    viewId === "gallery" ||
    viewId === "gallery-compose" ||
    viewId === "patterns-map";

  legendBtn.style.display   = wantsLegend ? 'block' : 'none';
  locationBtn.style.display = (viewId === 'map' || viewId === 'patterns-map' || viewId === 'unit') ? 'block' : 'none';
}


const topTabs = document.querySelectorAll('.top-tab');
const subnav = document.getElementById('subnav-patterns');
const subTabs = document.querySelectorAll('.sub-tab');

const VIEWS = {
  fragments: 'map',
  unit: 'unit-view',
  sub: {
    "patterns-map": "patterns-map",
    proxemic: "proxemic-view",
    gallery: "gallery-view",
    "gallery-compose": "gallery-compose-view",
    analogies: "analogies-view",
  }
};

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => { if (!v) return; v.style.display = (v.id === viewId) ? 'block' : 'none'; });
  if (viewId === 'map' && map?.invalidateSize) setTimeout(() => map.invalidateSize(), 0);
  if (viewId === 'unit-view' && unitMap?.invalidateSize) setTimeout(() => unitMap.invalidateSize(), 0);
}

function setTopTab(name) {
  topTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.top === name));
  if (name === 'patterns') {
    subnav.classList.remove('subnav--inactive');
    const currentActiveSub = document.querySelector('.sub-tab.active')?.dataset.sub || 'proxemic';
    setSubTab(currentActiveSub);
  } else {
    subnav.classList.add('subnav--inactive');
    subTabs.forEach(btn => btn.classList.remove('active'));
    if (name === 'fragments') { currentView = 'map'; showView(VIEWS.fragments); }
    if (name === 'unit')      { currentView = 'unit'; showView(VIEWS.unit); ensureUnitMap(); renderAllUnits(); }
    updateInterfaceElements(currentView);
  }
  if (unitCreation.active && name !== 'patterns') stopUnitCreation();

  const similarityControls = document.getElementById('similarity-controls');
  similarityControls.style.display = (name === 'patterns') ? 'block' : 'none';
}

function setSubTab(subName) {
  if (unitCreation.active && subName !== "patterns-map") stopUnitCreation();

  if (subName === "proxemic") currentView = "proxemic";
  else if (subName === "gallery") currentView = "gallery";
  else if (subName === "patterns-map") currentView = "patterns-map";
  else if (subName === "gallery-compose") currentView = "gallery-compose";
  else if (subName === "analogies") currentView = "analogies";

  subTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.sub === subName));
  const viewId = VIEWS.sub[subName]; showView(viewId);

  if (subName === 'patterns-map') {
    initPatternMapOnce();
    setTimeout(() => patternMap.invalidateSize(), 0);
    recomputePatternsForPatternsMap();
renderPatternBaseGrey();
refreshPatternsMap();
  }
  if (subName === 'proxemic') showProxemicView();
   else if (subName === "gallery") {
    showGalleryView();
  } else if (subName === "gallery-compose") {
    applyFilters();                         // <<< ajouté
    recomputePatternsAndRefreshViews();     // <<< ajouté
    showGalleryComposeView();
  } else if (subName === "analogies") {
    initAnalogiesOnce();
    showAnalogiesView();
  }



   // --- 🔎 slider de similarité : pas sur "Composition" ---
  const similarityControls = document.getElementById("similarity-controls");
// Vues où le slider doit être caché
const hideSlider = (subName === "gallery-compose" || subName === "analogies");
similarityControls.style.display = hideSlider ? "none" : "block";


  updateInterfaceElements(currentView);
}

function maybeHideTabbedOnViewChange() {
  if (currentView !== 'patterns-map' && Tabbed?.el) {
    Tabbed.openTabs?.forEach((_rec, id) => closeTab(id));
    Tabbed.el.style.display = 'none';
  }
}

// Listeners onglets
topTabs.forEach(btn => btn.addEventListener('click', () => setTopTab(btn.dataset.top)));
subTabs.forEach(btn => btn.addEventListener('click', () => setSubTab(btn.dataset.sub)));

// État initial
setTopTab('fragments');
currentView = 'map';
updateInterfaceElements('map');


/*==================================================
=                  ABOUT (Info)                    =
==================================================*/
document.addEventListener('DOMContentLoaded', () => {
  const infoBtn = document.getElementById('info-btn');
  const aboutBox = document.getElementById('about');
  function toggleAbout() {
    const isOpen = aboutBox.style.display === 'block';
    aboutBox.style.display = isOpen ? 'none' : 'block';
    if (infoBtn) infoBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  }
  if (infoBtn) infoBtn.addEventListener('click', toggleAbout);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aboutBox.style.display === 'block') toggleAbout(); });
});

document.addEventListener('DOMContentLoaded', () => {
  /* -------------------------
     RESET CHECKBOXES → cochées
  ------------------------- */

  // Zones (Montreuil / Mirail)
  document.querySelectorAll('.filter-zone').forEach(cb => {
    cb.checked = true;
  });

  // Critères fuzzy
  document.querySelectorAll('.crit-key').forEach(cb => {
    cb.checked = true;
  });

  // Reset état interne fuzzy
  ACTIVE_FUZZY_KEYS = new Set(ALL_FUZZY_KEYS);

  // Recalcul général
  applyFilters();
  recomputePatternsAndRefreshViews();
});


/***************************************************
=          SLIDER SEUIL DE SIMILARITÉ (FUZZY)      =
***************************************************/

function debounce(fn, delay = 160) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

const sliderEl = document.getElementById('similarity-slider');
const sliderValueEl = document.getElementById('slider-value');

if (sliderEl && sliderValueEl) {
  // Valeur initiale (75 → 0.75 par défaut)
  const initial = parseInt(sliderEl.value, 10) / 100;
  SIM_THRESHOLD = initial;
  sliderValueEl.textContent = initial.toFixed(2);

  sliderEl.addEventListener('input', debounce(e => {
    const v = parseInt(e.target.value, 10);    // ex : 50–95
    SIM_THRESHOLD = v / 100;                   // 0.50–0.95
    sliderValueEl.textContent = SIM_THRESHOLD.toFixed(2);

    const visible = [
      ...(dataGeojson || []),
      ...(datamGeojson || [])
    ]
      .filter(f => isFeatureInActiveZones ? isFeatureInActiveZones(f) : true)
      .filter(f => !f.properties?.isDiscourse);

    recomputePatternsAndRefreshViews();

    if (currentView === 'gallery')       showGalleryView();
    else if (currentView === 'proxemic') {
    const svg = d3.select("#proxemic-view svg");
    const world = svg.select("g"); 
    const oldTransform = world.attr("transform"); 

    showProxemicView();

    // Réappliquer la transformation précédente
    const newSvg = d3.select("#proxemic-view svg");
    const newWorld = newSvg.select("g");
    if (oldTransform) newWorld.attr("transform", oldTransform);
}

    else if (currentView === 'patterns-map') {
      renderPatternBaseGrey();
      refreshPatternsMap();
    }
  }, 160));
}

/*==================================================
=        CARTE PATTERNS : INIT + COULEURS          =
==================================================*/

let patternMap = null;
let patternBaseLayer = null;          // fragments gris
let patternImageLayer = null;         // vignettes des fragments
let patternLinkLayer = null;          // liens fins colorés
let _fragCenterCache = new Map();     // cache centres des fragments
let _stickyFragId = null;             // fragment cliqué = mode "sticky"

/* ---- COULEURS DES PATTERNS (inchangé) ---- */
const SAT_SEQ = [95, 85, 90, 80];
const LIT_SEQ = [58, 70, 50, 64];
const PATTERN_COLORS = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => {
    const hue = Math.round((i * 137.508) % 360);
    const sat = SAT_SEQ[i % SAT_SEQ.length];
    const lit = LIT_SEQ[(Math.floor(i / 4)) % LIT_SEQ.length];
    return [`P${i + 1}`, `hsl(${hue}, ${sat}%, ${lit}%)`];
  })
);

function colorForPattern(pName) {
  if (PATTERN_COLORS[pName]) return PATTERN_COLORS[pName];
  const n = parseInt(String(pName).replace(/^P/i, ''), 10);
  if (Number.isFinite(n)) {
    const idx = ((n - 1) % 100) + 1;
    return PATTERN_COLORS[`P${idx}`];
  }
  let h = 0;
  for (const c of String(pName)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 90%, 55%)`;
}
window.colorForPattern = colorForPattern;

/* ---- ZONES ACTIVES ----- */
function getActiveZones() {
  return Array.from(document.querySelectorAll('.filter-zone:checked')).map(cb => cb.value);
}
function isFeatureInActiveZones(f) {
  const zones = getActiveZones();
  const zone = f.properties?.zone || f.zone || null;
  if (!zone) return true;
  return zones.includes(zone);
}

/* ---- LISTE DES PATTERNS D’UN FRAGMENT ---- */
function getPatternsForFragment(fragmentId) {
  const result = [];
  Object.entries(patterns || {}).forEach(([pName, pData]) => {
    if ((pData.elements || []).includes(fragmentId)) result.push(pName);
  });
  result.sort((a, b) => parseInt(a.replace('P', ''), 10) - parseInt(b.replace('P', ''), 10));
  return result;
}

/* ---- INIT CARTE ---- */
function initPatternMapOnce() {
  if (patternMap) return;

  patternMap = L.map('patterns-map', {
    zoomControl: true,
    attributionControl: true
  }).setView(montreuilView, montreuilZoom);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors, © CartoDB'
  }).addTo(patternMap);

  patternBaseLayer = L.layerGroup().addTo(patternMap);
  patternImageLayer = L.layerGroup().addTo(patternMap);
  patternLinkLayer = L.layerGroup().addTo(patternMap);

  // Pane pour les liens colorés
  patternMap.createPane("pane-links");
  patternMap.getPane("pane-links").style.zIndex = 800;

  patternMap.on("zoomend moveend", () => {
    if (_stickyFragId) drawLinksForFragment(_stickyFragId);
  });

  // clic extérieur = reset sticky
  patternMap.on("click", (e) => {
    if (!e.originalEvent?.target?.closest(".frag-thumb")) {
      clearSticky();
    }
  });

  fetch('data/contour.geojson')
    .then(r => r.json())
    .then(contour => {
      L.geoJSON(contour, {
        style: { color: '#919090', weight: 2, opacity: 0.8, fillOpacity: 0 }
      }).addTo(patternMap);
    });
}

/* ---- CENTRE FEATURE ---- */
function getFeatureCenter(feature) {
  if (feature.geometry?.type === 'Point') {
    const c = feature.geometry.coordinates;
    return L.latLng(c[1], c[0]);
  }
  const tmp = L.geoJSON(feature);
  try {
    return tmp.getBounds().getCenter();
  } catch (e) {
    const c = (feature.geometry?.coordinates?.[0]) || [0, 0];
    return L.latLng(c[1] || 0, c[0] || 0);
  }
}

/* ---- RENDER GRIS ---- */
function renderPatternBaseGrey() {
  if (!patternMap) return;
  patternBaseLayer.clearLayers();

  const baseStyle = {
    color: '#777',
    weight: 1,
    opacity: 1,
    fillColor: '#777',
    fillOpacity: 0.25
  };

  const filterActiveZones = feat => isFeatureInActiveZones(feat) && !feat.properties.isDiscourse;

  if (dataGeojson?.length) {
    L.geoJSON({ type:'FeatureCollection', features: dataGeojson }, {
      filter: filterActiveZones,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { ...baseStyle, radius: 4 }),
      style: () => baseStyle,
      onEachFeature: (feature, layer) => layer.on("click", () => onPatternsMapFragmentClick(feature))
    }).addTo(patternBaseLayer);
  }

  if (datamGeojson?.length) {
    L.geoJSON({ type:'FeatureCollection', features: datamGeojson }, {
      filter: filterActiveZones,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { ...baseStyle, radius: 4 }),
      style: () => baseStyle,
      onEachFeature: (feature, layer) => layer.on("click", () => onPatternsMapFragmentClick(feature))
    }).addTo(patternBaseLayer);
  }
}

/* ---- STICKY + DIM ---- */
function clearPatternLinks() {
  patternLinkLayer.clearLayers();
}
function clearSticky() {
  _stickyFragId = null;
  clearPatternLinks();
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement()?.querySelector(".frag-thumb");
    el?.classList.remove("--active");
    el?.classList.remove("dim");
  });
}
function undimAll() {
  patternImageLayer.eachLayer((m) => {
    const el = m.getElement()?.querySelector(".frag-thumb");
    el?.classList.remove("dim");
  });
}
function dimUnrelated(srcFragId) {
  const related = new Set([srcFragId]);
  const pList = getPatternsForFragment(srcFragId);

  pList.forEach((pName) => {
    (patterns[pName]?.elements || []).forEach(id => related.add(id));
  });

  patternImageLayer.eachLayer((m) => {
    const id = m._fragId;
    const el = m.getElement()?.querySelector(".frag-thumb");
    if (!related.has(id)) el?.classList.add("dim");
    else el?.classList.remove("dim");
  });
}

/* ---- OFFSET DES LIGNES ---- */
function offsetLineLatLngs(aLatLng, bLatLng, offsetPx) {
  const p1 = patternMap.latLngToLayerPoint(aLatLng);
  const p2 = patternMap.latLngToLayerPoint(bLatLng);
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;

  const p1o = L.point(p1.x + nx * offsetPx, p1.y + ny * offsetPx);
  const p2o = L.point(p2.x + nx * offsetPx, p2.y + ny * offsetPx);

  return [
    patternMap.layerPointToLatLng(p1o),
    patternMap.layerPointToLatLng(p2o)
  ];
}

/* ---- LIENS ENTRE FRAGMENTS ---- */
function centerForFragmentId(id) {
  if (_fragCenterCache.has(id)) return _fragCenterCache.get(id);

  const feat = [...(dataGeojson || []), ...(datamGeojson || [])]
    .find(f => f.properties?.id === id);

  if (!feat) return null;

  const c = getFeatureCenter(feat);
  _fragCenterCache.set(id, c);
  return c;
}

function drawLinksForFragment(srcFragId) {
  clearPatternLinks();

  let pList = getPatternsForFragment(srcFragId);
  if (!pList.length) return;

  const srcCenter = centerForFragmentId(srcFragId);
  if (!srcCenter) return;

  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map((f) => [f.properties.id, f]));

  const destToPatterns = new Map();

  pList.forEach((pName) => {
    const members = patterns[pName]?.elements || [];
    members.forEach((dstId) => {
      if (dstId === srcFragId) return;
      const dst = byId.get(dstId);
      if (!dst || !isFeatureInActiveZones(dst)) return;

      const arr = destToPatterns.get(dstId) || [];
      arr.push(pName);
      destToPatterns.set(dstId, arr);
    });
  });

  const SPACING = 4;

  destToPatterns.forEach((pNames, dstId) => {
    const dstCenter = centerForFragmentId(dstId);
    if (!dstCenter) return;

    pNames = pNames.slice().sort(
      (a, b) => parseInt(a.replace("P", "")) - parseInt(b.replace("P", ""))
    );

    const n = pNames.length;

    for (let i = 0; i < n; i++) {
      const offset = (i - (n - 1) / 2) * SPACING;
      const [aOff, bOff] = offsetLineLatLngs(srcCenter, dstCenter, offset);
      const color = colorForPattern(pNames[i]);

      L.polyline([aOff, bOff], {
        pane: "pane-links",
        color,
        weight: 2,
        opacity: 0.95,
        lineCap: "round",
      }).addTo(patternLinkLayer);
    }
  });
}

/* ---- RAFRAICHISSEMENT PRINCIPAL ---- */

function recomputePatternsForPatternsMap() {
  // On prend SEULEMENT les fragments :
  // - dans les zones actives
  // - sans discours
  // - avec au moins 1 critère actif non-null
  const visible = [...dataGeojson, ...datamGeojson]
    .filter(f => isFeatureInActiveZones(f))
    .filter(f => !f.properties?.isDiscourse)
    .filter(f => hasAnyActiveCriterion(f));

  // Recalcule des patterns avec critères désactivés ignorés
  patterns = identifyPatterns(visible);
}


function refreshPatternsMap() {
  if (!patternMap) return;

  patternImageLayer.clearLayers();
  patternLinkLayer.clearLayers();
  _fragCenterCache.clear();

  combinedFeatures = [...(dataGeojson || []), ...(datamGeojson || [])];

  const byId = new Map(combinedFeatures.map(f => [f.properties.id, f]));

  const eligible = [];
  Object.entries(patterns || {}).forEach(([pName, pData]) => {
    (pData.elements || []).forEach((id) => {
      const feat = byId.get(id);
      if (!feat) return;
      if (!isFeatureInActiveZones(feat)) return;
      if (!hasAnyActiveCriterion(feat)) return;
      eligible.push(id);
    });
  });

  const uniqIds = Array.from(new Set(eligible));

  uniqIds.forEach((fragId) => {
    const feat = byId.get(fragId);
    const center = getFeatureCenter(feat);

    const photos = normalizePhotos(feat.properties.photos);
    const photo = cleanPhotoUrl(photos[0] || null);

    const html = photo
      ? `<img class="frag-thumb" src="${photo}">`
      : `<div class="frag-thumb --placeholder"></div>`;

    const icon = L.divIcon({
      className: "frag-thumb-ic",
      html,
      iconSize: [56, 42],
iconAnchor: [28, 21],
    });

    const marker = L.marker(center, { icon, riseOnHover: true });
    marker._fragId = fragId;

    // Hover
    marker.on("mouseover", () => {
      if (_stickyFragId) return;
      drawLinksForFragment(fragId);
      dimUnrelated(fragId);
    });

    marker.on("mouseout", () => {
      if (_stickyFragId) return;
      clearPatternLinks();
      undimAll();
    });

    // Click sticky
    marker.on("click", (ev) => {
      const el = marker.getElement()?.querySelector(".frag-thumb");
      clearSticky();
      _stickyFragId = fragId;
      el?.classList.add("--active");

      drawLinksForFragment(fragId);
      dimUnrelated(fragId);

      onPatternsMapFragmentClick(feat);
      ev.originalEvent.stopPropagation();
    });

    marker.addTo(patternImageLayer);
  });
}

/* ---- CLIC SUR FRAGMENT ---- */
function onPatternsMapFragmentClick(feature) {
  if (unitCreation.active) {
    handleUnitSelection(feature);
    return;
  }
  openFragmentWithPatternsTabs(feature.properties || {});
}


/*==================================================
=             MODE CRÉATION D’UNITÉ (UP)           =
==================================================*/
function startUnitCreation() {
  setTopTab('patterns');
  setSubTab('patterns-map');
  initPatternMapOnce();
  if (unitCreation.active) return;
  unitCreation.active = true;

  if (patternOverlayGroup && patternMap.hasLayer(patternOverlayGroup)) {
    patternMap.removeLayer(patternOverlayGroup); unitCreation.ringsVisible = false;
  }
  const btn = document.getElementById('create-unit-btn');
  if (btn) { btn.textContent = 'Annuler la création'; btn.classList.add('is-armed'); btn.setAttribute('aria-pressed','true'); }
  const cont = patternMap.getContainer(); cont.classList.add('patterns-creating');
  const hint = document.getElementById('unit-hint'); hint.style.display = 'block';
  unitCreation.mouseMoveHandler = (e) => { hint.style.left = e.clientX + 'px'; hint.style.top = e.clientY + 'px'; };
  window.addEventListener('mousemove', unitCreation.mouseMoveHandler);
}
function stopUnitCreation() {
  if (!unitCreation.active) return;
  unitCreation.active = false;
  if (!unitCreation.ringsVisible && patternOverlayGroup) { patternOverlayGroup.addTo(patternMap); unitCreation.ringsVisible = true; }
  const btn = document.getElementById('create-unit-btn');
  if (btn) { btn.textContent = 'Créer une Unité de Projet'; btn.classList.remove('is-armed'); btn.setAttribute('aria-pressed','false'); }
  const cont = patternMap.getContainer(); cont.classList.remove('patterns-creating');
  const hint = document.getElementById('unit-hint'); hint.style.display = 'none';
  if (unitCreation.mouseMoveHandler) { window.removeEventListener('mousemove', unitCreation.mouseMoveHandler); unitCreation.mouseMoveHandler = null; }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && unitCreation.active) stopUnitCreation(); });

// Bouton toggle création UP
const createUnitBtn = document.getElementById('create-unit-btn');
if (createUnitBtn) createUnitBtn.addEventListener('click', () => { unitCreation.active ? stopUnitCreation() : startUnitCreation(); });

// Sélection d’un fragment ⇒ création UP locale
function handleUnitSelection(feature) {
  stopUnitCreation();

  // ➜ on récupère le code du fragment (ex: "M12…" ou "N07…")
  const srcId = feature?.properties?.id || 'UNK';
  let unitId = `UP-${srcId}`;

  // (optionnel) si une unité avec le même ID existe déjà, on différencie
  const exists = loadUnitsLocal().some(u => u.id === unitId);
  if (exists) unitId = `UP-${srcId}-${Date.now().toString().slice(-4)}`;

  const unit = {
    id: unitId,
    sourceFragmentId: srcId,
    geometry: feature.geometry,
    // ➜ le "nom" affiché partout = l'ID voulu
    props: { name: unitId },
    createdAt: new Date().toISOString()
  };

  saveUnitLocal(unit);
  setTopTab('unit');
  showView('unit-view');
  setTimeout(() => { renderAllUnits(); zoomToUnit(unit); }, 0);
}


function saveUnitLocal(unit) {
  try {
    const key = 'units'; const arr = JSON.parse(localStorage.getItem(key) || '[]'); arr.push(unit);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) { console.warn('Impossible d’enregistrer localement l’unité :', e); }
}
function loadUnitsLocal() {
  try { return JSON.parse(localStorage.getItem('units') || '[]'); }
  catch(e) { return []; }
}

function ensureUnitMap() {
  if (unitMap) { setTimeout(() => unitMap.invalidateSize(), 0); return unitMap; }

  unitMap = L.map('unit-view', { zoomControl:true, attributionControl:true })
              .setView(montreuilView, montreuilZoom);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors, © CartoDB'
  }).addTo(unitMap);

  unitContextGroup = L.layerGroup().addTo(unitMap);
  unitLayerGroup   = L.layerGroup().addTo(unitMap);

  // ⬇️ ICI : contour non interactif + au fond
  fetch('data/contour.geojson').then(r => r.json()).then(contour => {
    const contourLayer = L.geoJSON(contour, {
      style: { color:'#919090', weight:2, opacity:0.8, fillOpacity:0 },
      interactive: false              // ✅ ne capte plus les clics
    }).addTo(unitContextGroup);
    contourLayer.bringToBack();        // ✅ passe sous les unités
  });

  return unitMap;
}


function renderAllUnits() {
  const mapU = ensureUnitMap();
  unitLayerGroup.clearLayers();
  const whiteStyle = { color:'#fff', weight:2, opacity:1, fillColor:'#fff', fillOpacity:0.25 };
  const units = loadUnitsLocal();
  let unionBounds = null;

  units.forEach(u => {
    const gj = L.geoJSON({ type:'Feature', geometry:u.geometry, properties:u.props }, {
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, { ...whiteStyle, radius: 6 }),
      style: () => whiteStyle
    }).addTo(unitLayerGroup);

    // >>> clic fiable sur chaque géométrie de l'unité
    gj.eachLayer(layer => {
  layer.on('click', () => {
    openUnitModal(u);   // ✨ nouvelle modale au lieu du panneau
  });
});


    if (gj.getBounds) {
      const b = gj.getBounds();
      unionBounds = unionBounds ? unionBounds.extend(b) : b;
    }
  });

  if (unionBounds && unionBounds.isValid && unionBounds.isValid()) mapU.fitBounds(unionBounds.pad(0.3));
}


function zoomToUnit(unit) {
  const mapU = ensureUnitMap();
  try {
    const tmp = L.geoJSON({ type:'Feature', geometry:unit.geometry });
    const b = tmp.getBounds?.();
    if (b && b.isValid && b.isValid()) { mapU.fitBounds(b.pad(0.3)); return; }
  } catch(e) {}
  const center = getFeatureCenter({ geometry: unit.geometry }); if (center) mapU.setView(center, 17);
}
function showUnitOnMap(unit) {
  const mapU = ensureUnitMap();
  const whiteStyle = { color:'#fff', weight:2, opacity:1, fillColor:'#fff', fillOpacity:0.25 };
  const layer = L.geoJSON({ type:'Feature', geometry:unit.geometry, properties:unit.props }, {
    pointToLayer: (_f, latlng) => L.circleMarker(latlng, { ...whiteStyle, radius: 6 }),
    style: () => whiteStyle
  }).addTo(unitLayerGroup);
  try {
    const b = layer.getBounds?.();
    if (b && b.isValid && b.isValid()) mapU.fitBounds(b.pad(0.3));
    else { const center = getFeatureCenter({ geometry: unit.geometry }); if (center) mapU.setView(center, 17); }
  } catch(e) { console.warn('Fit bounds unité :', e); }
}



/*==================================================
=     INSPECTEUR D’UNITÉ : V1 / V2 / COMPARER      =
==================================================*/


/* ========== MODALE UNITÉ (plein écran) ========== */
let unitModalState = {
  unit: null,
  singleViewer: null,
  v1Viewer: null,
  v2Viewer: null,
};

function openUnitModal(unit) {
  unitModalState.unit = unit;

  const modal   = document.getElementById('unit-modal');
  const titleEl = document.getElementById('unit-title');
  const btnV1   = document.getElementById('unit-btn-v1');
  const btnV2   = document.getElementById('unit-btn-v2');
  const btnCmp  = document.getElementById('unit-btn-compare');
  const btnX    = document.getElementById('unit-close');

  // titre = ID de l'unité
  titleEl.textContent = unit.props?.name || unit.id;

  // fragment source de l'unité (là où vit la V1)
  const fragId = unit.sourceFragmentId || null;
  const hasV1  = fragId ? hasFragment3D(fragId) : false;

  // --- Bouton V1 : soit "V1" (affiche), soit "Importer V1" (ouvre le file picker)
  if (hasV1) {
    btnV1.textContent = 'V1';
    btnV1.onclick = async () => {
      disposeUnitCompare();
      showUnitSingle();
      await renderUnitV1Into(document.getElementById('unit-single-host'));
    };
  } else {
    btnV1.textContent = 'Importer V1';
    btnV1.onclick = () => {
      promptImportV1ForSourceFragment(fragId, async () => {
        // une fois importée : on passe le bouton en "V1" et on affiche
        btnV1.textContent = 'V1';
        disposeUnitCompare();
        showUnitSingle();
        await renderUnitV1Into(document.getElementById('unit-single-host'));
      });
    };
  }

  // --- Bouton V2 : inchangé (import si pas encore là)
  btnV2.textContent = hasUnit3D(unit.id) ? 'V2' : 'Importer V2';
  btnV2.onclick = async () => {
    if (!hasUnit3D(unit.id)) {
      promptImport3DForUnit(unit.id, async () => {
        btnV2.textContent = 'V2';
        disposeUnitCompare();
        showUnitSingle();
        await renderUnitV2Into(document.getElementById('unit-single-host'));
      });
      return;
    }
    disposeUnitCompare();
    showUnitSingle();
    await renderUnitV2Into(document.getElementById('unit-single-host'));
  };

  // --- Bouton Comparer : inchangé (demande une V2, la V1 est lue sur le fragment)
  btnCmp.onclick = async () => {
    if (!hasUnit3D(unit.id)) {
      promptImport3DForUnit(unit.id, async () => {
        btnV2.textContent = 'V2';
        await doUnitCompare();
      });
    } else {
      await doUnitCompare();
    }
  };

  // fermeture
  document.getElementById('unit-backdrop').onclick = closeUnitModal;
  btnX.onclick = closeUnitModal;

  // on écoute les MAJ des métadonnées du fragment (labels 3D)
  function onMetaUpdated(e) {
    if (e.detail?.fragmentId !== fragId) return;
    const meta = e.detail.meta || { usages:[], discours:[] };
    unitModalState.singleViewer?.setLabelsFromMeta?.(meta);
    unitModalState.v1Viewer?.setLabelsFromMeta?.(meta);
    unitModalState.v2Viewer?.setLabelsFromMeta?.(meta);
  }
  window.addEventListener('fragmeta:updated', onMetaUpdated);
  modal.__cleanupMetaListener = onMetaUpdated;

  // afficher la modale
  modal.style.display = 'block';

  // Démarrage :
  // - si V1 existe déjà → on l’affiche
  // - sinon → on reste en vue simple, en attendant que l’utilisateur clique "Importer V1"
  showUnitSingle();
  if (hasV1) btnV1.click();
}


function closeUnitModal() {
  const modal = document.getElementById('unit-modal');
  modal.style.display = 'none';

  disposeUnitSingle();
  disposeUnitCompare();

  // nettoie l'écouteur meta
  if (modal.__cleanupMetaListener) {
    window.removeEventListener('fragmeta:updated', modal.__cleanupMetaListener);
    modal.__cleanupMetaListener = null;
  }

  unitModalState.unit = null;
}

function showUnitSingle() {
  document.getElementById('unit-single-host').style.display   = 'block';
  document.getElementById('unit-compare-host').style.display  = 'none';
}

function showUnitCompare() {
  document.getElementById('unit-single-host').style.display   = 'none';
  document.getElementById('unit-compare-host').style.display  = 'flex';
}

function disposeUnitSingle() {
  if (unitModalState.singleViewer) {
    unitModalState.singleViewer.dispose?.();
    unitModalState.singleViewer = null;
  }
}

function disposeUnitCompare() {
  if (unitModalState.v1Viewer) { unitModalState.v1Viewer.dispose?.(); unitModalState.v1Viewer = null; }
  if (unitModalState.v2Viewer) { unitModalState.v2Viewer.dispose?.(); unitModalState.v2Viewer = null; }
}

/* Renderers (réutilisent la logique existante) */
async function renderUnitV1Into(container) {
  if (!window.__ThreeFactory__) { console.error('Viewer 3D non chargé.'); return null; }
  container.innerHTML = ''; 
  const { unit } = unitModalState;
  const fragId = unit.sourceFragmentId || null;

  const viewer = window.__ThreeFactory__.createThreeViewer(container);
  const rec = fragId ? loadFragment3D(fragId) : null;
  if (rec?.dataUrl) {
    const blob = dataURLtoBlob(rec.dataUrl);
    await viewer.showBlob(blob);
  }
  const meta = fragId ? loadFragmentMeta(fragId) : { usages:[], discours:[] };
  viewer.setLabelsFromMeta?.(meta);

  unitModalState.singleViewer = viewer;
  return viewer;
}

async function renderUnitV2Into(container) {
  if (!window.__ThreeFactory__) { console.error('Viewer 3D non chargé.'); return null; }
  container.innerHTML = '';   
  const { unit } = unitModalState;

  const viewer = window.__ThreeFactory__.createThreeViewer(container);
  const rec = loadUnit3D(unit.id);
  if (rec?.dataUrl) {
    const blob = dataURLtoBlob(rec.dataUrl);
    await viewer.showBlob(blob);
  }
  const meta = unit.sourceFragmentId ? loadFragmentMeta(unit.sourceFragmentId) : { usages:[], discours:[] };
  viewer.setLabelsFromMeta?.(meta);

  unitModalState.singleViewer = viewer;
  return viewer;
}

async function doUnitCompare() {
  disposeUnitSingle();
  showUnitCompare();

  const v1 = await (async () => {
    const c = document.getElementById('unit-v1-host');
    if (!window.__ThreeFactory__) return null;
    const v = window.__ThreeFactory__.createThreeViewer(c);
    const fragId = unitModalState.unit.sourceFragmentId || null;
    const rec = fragId ? loadFragment3D(fragId) : null;
    if (rec?.dataUrl) await v.showBlob(dataURLtoBlob(rec.dataUrl));
    const meta = fragId ? loadFragmentMeta(fragId) : { usages:[], discours:[] };
    v.setLabelsFromMeta?.(meta);
    return v;
  })();

  const v2 = await (async () => {
    const c = document.getElementById('unit-v2-host');
    if (!window.__ThreeFactory__) return null;
    const v = window.__ThreeFactory__.createThreeViewer(c);
    const rec = loadUnit3D(unitModalState.unit.id);
    if (rec?.dataUrl) await v.showBlob(dataURLtoBlob(rec.dataUrl));
    const meta = unitModalState.unit.sourceFragmentId ? loadFragmentMeta(unitModalState.unit.sourceFragmentId) : { usages:[], discours:[] };
    v.setLabelsFromMeta?.(meta);
    return v;
  })();

  unitModalState.v1Viewer = v1;
  unitModalState.v2Viewer = v2;
}


/*---------------------------------------
STOCKAGE LOCAL 3D (helpers)
  (appelé par la modale 3D)
---------------------------------------*/
function saveFragment3D(fragmentId, fileName, mime, dataUrl) {
  localStorage.setItem(`frag3d:${fragmentId}`, JSON.stringify({ fileName, mime, dataUrl, savedAt: Date.now() }));
}
function loadFragment3D(fragmentId) {
  try { return JSON.parse(localStorage.getItem(`frag3d:${fragmentId}`) || 'null'); }
  catch(e){ return null; }
}
function hasFragment3D(fragmentId) { return !!localStorage.getItem(`frag3d:${fragmentId}`); }

/*==================================================
=       STOCKAGE LOCAL 3D — V2 (par Unité)         =
==================================================*/
function saveUnit3D(unitId, fileName, mime, dataUrl) {
  localStorage.setItem(`unit3dV2:${unitId}`, JSON.stringify({
    fileName, mime, dataUrl, savedAt: Date.now()
  }));
}
function loadUnit3D(unitId) {
  try { return JSON.parse(localStorage.getItem(`unit3dV2:${unitId}`) || 'null'); }
  catch(e){ return null; }
}
function hasUnit3D(unitId) { return !!localStorage.getItem(`unit3dV2:${unitId}`); }

function promptImport3DForUnit(unitId, onLoaded) {
  const input = document.getElementById('three-file-input');
  input.value = '';
  input.onchange = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
    saveUnit3D(unitId, file.name, file.type || 'model/gltf-binary', dataUrl);
    if (typeof onLoaded === 'function') onLoaded(dataUrl);
  };
  input.click();
}

// Importer une V1 pour le fragment source d'une unité (depuis la modale Unité)
function promptImportV1ForSourceFragment(fragmentId, onLoaded) {
  if (!fragmentId) return;
  const input = document.getElementById('three-file-input');
  input.value = '';
  input.onchange = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
    // ⬇️ on enregistre la V1 sur le fragment (même clé que la carte Fragments)
    saveFragment3D(fragmentId, file.name, file.type || 'model/gltf-binary', dataUrl);

    // Broadcast (si tu veux réagir ailleurs)
    window.dispatchEvent(new CustomEvent('frag3d:updated', { detail: { fragmentId } }));

    // callback local (pour recharger la vue dans la modale)
    if (typeof onLoaded === 'function') onLoaded(dataUrl);
  };
  input.click();
}


/*==================================================
=                 MODALE 3D (Three)                =
==================================================*/
let activeViewer = null;
let activeFragmentId = null;

function openThreeModalForFragment(fragmentId) {
  if (!window.__ThreeFactory__) { console.error('Viewer 3D non chargé.'); return; }
  activeFragmentId = fragmentId;
  const modal = document.getElementById('three-modal');
  const host  = document.getElementById('three-canvas-host');
  const btnClose = document.getElementById('three-close');
  const btnLoad  = document.getElementById('three-load-btn');

  modal.style.display = 'block';
  activeViewer = window.__ThreeFactory__?.createThreeViewer(host);

  const rec = loadFragment3D(fragmentId);
  if (rec?.dataUrl) {
    const blob = dataURLtoBlob(rec.dataUrl);
    activeViewer.showBlob(blob).then(() => {
      const meta = loadFragmentMeta(fragmentId);
      activeViewer.setLabelsFromMeta?.(meta);
    });
  } else {
    const meta = loadFragmentMeta(fragmentId);
    activeViewer.setLabelsFromMeta?.(meta);
  }

  document.getElementById('three-backdrop').onclick = closeThreeModal;
  btnClose.onclick = closeThreeModal;
  btnLoad.onclick  = () => promptImport3DForFragment(fragmentId, true);

  function onMetaUpdated(e){
    if (e.detail?.fragmentId === activeFragmentId && activeViewer) {
      activeViewer.setLabelsFromMeta?.(e.detail.meta);
    }
  }
  window.addEventListener('fragmeta:updated', onMetaUpdated);
  function escCloseThreeOnce(e){ if (e.key === 'Escape') closeThreeModal(); }
  document.addEventListener('keydown', escCloseThreeOnce);
  modal.__cleanupMetaListener = onMetaUpdated;
  modal.__escHandler = escCloseThreeOnce;
}

function closeThreeModal() {
  const modal = document.getElementById('three-modal');
  modal.style.display = 'none';
  if (modal.__escHandler) { document.removeEventListener('keydown', modal.__escHandler); modal.__escHandler = null; }
  if (modal.__cleanupMetaListener) { window.removeEventListener('fragmeta:updated', modal.__cleanupMetaListener); modal.__cleanupMetaListener = null; }
  if (activeViewer) { activeViewer.dispose?.(); activeViewer = null; }
  activeFragmentId = null;
}

function dataURLtoBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/)||[])[1] || 'application/octet-stream';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function promptImport3DForFragment(fragmentId, reloadIfOpen=false) {
  const input = document.getElementById('three-file-input');
  input.value = '';
  input.onchange = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
    saveFragment3D(fragmentId, file.name, file.type || 'model/gltf-binary', dataUrl);
    if (reloadIfOpen && activeViewer) {
      await activeViewer.showBlob(dataURLtoBlob(dataUrl));
      const meta = loadFragmentMeta(fragmentId);
      activeViewer.setLabelsFromMeta?.(meta); // évite la double ligne inutile
    }
  };
  input.click();
}


/*==================================================
=           SAVED PATTERNS (localStorage)          =
==================================================*/
const SAVED_PATTERNS_KEY = 'savedPatternsV1';

function loadSavedPatterns(){
  try { return JSON.parse(localStorage.getItem(SAVED_PATTERNS_KEY) || '[]'); }
  catch(e){ return []; }
}
function saveSavedPatterns(arr){
  localStorage.setItem(SAVED_PATTERNS_KEY, JSON.stringify(arr));
}
function addSavedPattern(rec){
  const arr = loadSavedPatterns();
  arr.push(rec);
  saveSavedPatterns(arr);
}
function updateSavedPattern(uid, patch){
  const arr = loadSavedPatterns();
  const i = arr.findIndex(x => x.uid === uid);
  if (i >= 0) { arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() }; saveSavedPatterns(arr); }
}
function deleteSavedPattern(uid){
  saveSavedPatterns(loadSavedPatterns().filter(x => x.uid !== uid));
}
function fmtDate(iso){
  try { const d = new Date(iso); return d.toLocaleString(); } catch(e){ return iso || ''; }
}


/*==================================================
=   ÉDITEUR DE PATTERN (création ET modification)  =
==================================================*/

/**
 * Ouvre la même fenêtre modale que la création, mais en mode:
 *  - "create"  : on enregistre un NOUVEAU snapshot (addSavedPattern)
 *  - "edit"    : on modifie un snapshot existant (updateSavedPattern)
 *
 * options = {
 *   mode: 'create' | 'edit',
 *   patternKey,                // string (clé P1, P7…)
 *   elements: string[],        // ids des membres
 *   criteria: object,          // critères du snapshot
 *   name: string,              // nom initial (pré-rempli)
 *   description: string,       // desc initiale (pré-remplie)
 *   onSave: (payload) => void, // callback appelé quand on confirme
 *   headerText?: string,       // (facultatif) titre personnalisé
 *   saveText?: string          // (facultatif) libellé bouton
 * }
 */
function openPatternEditor(options) {
  const {
    mode = 'create',
    patternKey = '',
    elements = [],
    criteria = {},          // ⇐ maintenant on passe des critères fuzzy
    name = patternKey,
    description = '',
    onSave = () => {},
    headerText,
    saveText
  } = options || {};

  const modal   = document.getElementById('save-pattern-modal');
  modal.style.zIndex = '6000';
  document.body.appendChild(modal);

  const keyEl   = document.getElementById('sp-key');
  const nameEl  = document.getElementById('sp-name');
  const descEl  = document.getElementById('sp-desc');
  const listEl  = document.getElementById('sp-fragments');
  const countEl = document.getElementById('sp-frag-count');
  const btnSave   = document.getElementById('sp-save');
  const btnCancel = document.getElementById('sp-cancel');

  // Titre & labels
  const headTitle = modal.querySelector('.modal__head strong');
  headTitle.textContent = headerText || (mode === 'edit' ? 'Modifier ce pattern' : 'Enregistrer ce pattern');
  btnSave.textContent   = saveText   || (mode === 'edit' ? 'Enregistrer les modifications' : 'Enregistrer');

  // Champs
  keyEl.value   = patternKey;
  nameEl.value  = (name || patternKey).trim();
  descEl.value  = description || '';

  // Liste des fragments membres
  countEl.textContent = String(elements.length);
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map(f => [f.properties.id, f]));
  listEl.innerHTML = '';
  elements.forEach(id => {
    const f = byId.get(id);
    const line = document.createElement('div');
    line.textContent = `${id}${f?.properties?.name ? ' — ' + f.properties.name : ''}`;
    listEl.appendChild(line);
  });

  function close() {
    modal.style.display = 'none';
    cleanup();
  }
  function cleanup() {
    document.querySelector('#save-pattern-modal .modal__backdrop').onclick = null;
    btnCancel.onclick = null;
    btnSave.onclick = null;
  }

  document.querySelector('#save-pattern-modal .modal__backdrop').onclick = close;
  btnCancel.onclick = close;

  btnSave.onclick = () => {
    const payload = {
      patternKey,
      name: (nameEl.value || patternKey).trim(),
      description: (descEl.value || '').trim(),
      elements: elements.slice(),
      criteria: criteria   // ⇐ on renvoie bien les critères fuzzy
    };
    onSave(payload);
    close();
  };

  modal.style.display = 'block';
}



/**
 * Calcule des critères "moyens" fuzzy pour une liste d'IDs de fragments.
 * Retourne un objet { cléFuzzy: valeurMoyenne } avec des nombres entre 0 et 1.
 */
function computeConsensusCriteriaForIds(ids) {
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map(f => [f.properties.id, f]));

  const consensus = {};

  ALL_FUZZY_KEYS.forEach((key, idx) => {
    let sum = 0;
    let count = 0;

    ids.forEach(id => {
      const f = byId.get(id);
      if (!f) return;
      const v = parseFuzzy(f.properties[key]);
      if (v === null || Number.isNaN(v)) return;
      sum += v;
      count++;
    });

    if (count > 0) {
      consensus[key] = sum / count;  // moyenne fuzzy
    }
  });

  return consensus;
}




/* --- Création : garde le même nom de fonction publique --- */
function openSavePatternModal(patternKey, patternData) {
  const els = (patternData?.elements || []).slice();

  // ⇨ On calcule les critères fuzzy "moyens" au moment du snapshot
  const consensus = computeConsensusCriteriaForIds(els);

  openPatternEditor({
    mode: 'create',
    patternKey,
    elements: els,
    criteria: consensus,
    name: (patternNames?.[patternKey]) || patternKey,
    description: '',
    onSave: (payload) => {
      const rec = {
        uid: 'sp_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
        ...payload,
        savedAt: new Date().toISOString()
      };
      addSavedPattern(rec);
      // Ouvre directement la fiche du pattern enregistré
      openSavedPatternPanel(rec.uid);
    }
  });
}


/* --- Édition d’un pattern SAUVEGARDÉ (par UID) --- */
function openEditSavedPatternModal(uid) {
  const items = loadSavedPatterns();
  const rec = items.find(x => x.uid === uid);
  if (!rec) return;

  openPatternEditor({
    mode: 'edit',
    patternKey: rec.patternKey,
    elements: rec.elements || [],
    criteria: rec.criteria || {},      // ⇐ on garde les critères fuzzy
    name: rec.name || rec.patternKey,
    description: rec.description || '',
    onSave: (payload) => {
      // On ne modifie ici que nom + description (les critères peuvent rester)
      updateSavedPattern(uid, {
        name: payload.name,
        description: payload.description
      });

      // rafraîchir la fiche ouverte si elle existe
      const tabId = `saved-${uid}`;
      const updated = loadSavedPatterns().find(x => x.uid === uid);
      if (Tabbed?.openTabs?.has(tabId)) {
        const panel = Tabbed.openTabs.get(tabId).panel;
        renderSavedPatternPanel(panel, updated);
        // mettre à jour le titre de l'onglet
        Tabbed.openTabs.get(tabId).btn.firstChild.nodeValue = (updated.name || updated.patternKey);
      }

      // rafraîchir la liste si la modale est ouverte
      const listModal = document.getElementById('saved-patterns-list-modal');
      if (listModal && listModal.style.display === 'block') {
        openSavedPatternsListModal();
      }
    }
  });
}







const savedListBtn = document.getElementById('saved-patterns-list-btn');
if (savedListBtn) savedListBtn.addEventListener('click', () => openSavedPatternsListModal());




function openSavedPatternsListModal(){
  const modal = document.getElementById('saved-patterns-list-modal');
  const body  = document.getElementById('splist-body');
  const closeBtn = document.getElementById('splist-close');

  body.innerHTML = '';
  const items = loadSavedPatterns().slice().sort((a,b) => (new Date(b.savedAt)) - (new Date(a.savedAt)));

  if (!items.length){
    body.innerHTML = '<div style="color:#aaa">Aucun pattern enregistré pour le moment.</div>';
  } else {
    items.forEach(rec => {
      const card = document.createElement('div');
      card.className = 'saved-item';
      const h = document.createElement('h4');
      h.textContent = `${rec.name}  (${rec.patternKey})`;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `Enregistré: ${fmtDate(rec.savedAt)} • Fragments: ${rec.elements?.length || 0}`;
      const row = document.createElement('div');
      row.className = 'row';

      const bOpen = document.createElement('button');
      bOpen.className = 'tab-btn btn-sm primary';
      bOpen.textContent = 'Consulter';
      bOpen.onclick = () => { modal.style.display = 'none'; openSavedPatternPanel(rec.uid); };

       // ⬇️ Unifie Renommer + Modifier description
      const bEdit = document.createElement('button');
      bEdit.className = 'tab-btn btn-sm';
      bEdit.textContent = 'Modifier';
      bEdit.onclick = () => openEditSavedPatternModal(rec.uid);

      const bDel = document.createElement('button');
bDel.className = 'tab-btn btn-sm danger';
bDel.textContent = 'Supprimer';
bDel.onclick = () => {
  // suppression immédiate, sans confirmation
  deleteSavedPattern(rec.uid);
  // rafraîchir la liste
  openSavedPatternsListModal();
};


      row.append(bOpen, bEdit, bDel);
      const p = document.createElement('div');
      p.style.cssText = 'margin-top:6px;color:#ccc;white-space:pre-wrap';
      p.textContent = rec.description || '—';

      card.append(h, meta, row, p);
      body.appendChild(card);
    });
  }

  function close(){ modal.style.display = 'none'; cleanup(); }
  function cleanup(){ document.querySelector('#saved-patterns-list-modal .modal__backdrop').onclick = null; closeBtn.onclick = null; }
  document.querySelector('#saved-patterns-list-modal .modal__backdrop').onclick = close;
  closeBtn.onclick = close;

  modal.style.display = 'block';
}


function openSavedPatternPanel(uid) {
  const items = loadSavedPatterns();
  const rec = items.find(x => x.uid === uid);
  if (!rec) return;

  openTab({
    id: `saved-${uid}`,
    title: rec.name || rec.patternKey,
    kind: 'saved-pattern',
    render: panel => renderSavedPatternPanel(panel, rec)
  });
}

function renderSavedPatternPanel(panel, rec) {
  panel.innerHTML = '';

  /* --------------------------------------------
     1) Titre + méta
  -------------------------------------------- */
  const h2 = document.createElement('h2');
  h2.textContent = `${rec.name || rec.patternKey} — (enregistré)`;
  panel.appendChild(h2);

  const meta = document.createElement('div');
  meta.style.cssText = 'color:#aaa;font-size:12px;margin-bottom:8px';
  meta.textContent =
    `ID: ${rec.patternKey} • Fragments: ${rec.elements?.length || 0} • Sauvé: ${fmtDate(rec.savedAt)}` +
    (rec.updatedAt ? ` • Modifié: ${fmtDate(rec.updatedAt)}` : '');
  panel.appendChild(meta);

  /* --------------------------------------------
     2) Description
  -------------------------------------------- */
  const desc = document.createElement('p');
  desc.textContent = rec.description || '—';
  panel.appendChild(desc);

  /* --------------------------------------------
     3) CRITÈRES COMMUNS (moyenne fuzzy)
        => comme dans renderPatternPanel
  -------------------------------------------- */
  const ids = rec.elements || [];
  const consensus = computeConsensusCriteriaForIds(ids);

  const critBlock = document.createElement('div');
  critBlock.className = 'pattern-crit-block';

  const hCrit = document.createElement('h3');
  hCrit.textContent = 'Critères communs';
  critBlock.appendChild(hCrit);

  const entries = Object.entries(consensus)
    .filter(([k, v]) => v !== null && v >= 0.2)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    const none = document.createElement('p');
    none.textContent = 'Aucun critère commun significatif.';
    none.style.color = '#aaa';
    critBlock.appendChild(none);
  } else {
    entries.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'crit-row';

      const label = document.createElement('span');
      label.className = 'crit-label';
      label.textContent = k.replace(/_/g, ' ');

      const val = document.createElement('span');
      val.className = 'crit-value';
      val.textContent = v.toFixed(2);

      row.append(label, val);
      critBlock.appendChild(row);
    });
  }

  panel.appendChild(critBlock);

  /* --------------------------------------------
     4) Liste des fragments membres
        => simple, même style que pattern normal
  -------------------------------------------- */
  const list = document.createElement('div');
  list.className = 'pattern-members';

  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map(f => [f.properties.id, f]));

  ids.forEach(id => {
    const f = byId.get(id);
    if (!f) return;

    const row = document.createElement('div');
    row.className = 'member-row';

    // miniature
    const thumb = document.createElement('div');
    thumb.className = 'member-thumb';
    const p = normalizePhotos(f.properties.photos)[0];
    if (p) thumb.style.backgroundImage = `url("${p}")`;

    // nom
    const right = document.createElement('div');
    right.className = 'member-right';

    const title = document.createElement('div');
    title.className = 'member-title';
    title.textContent = f.properties.name || id;

    right.append(title);
    row.append(thumb, right);

    row.addEventListener('click', () => showDetails(f.properties));
    list.appendChild(row);
  });

  panel.appendChild(list);

  /* --------------------------------------------
     5) Actions
  -------------------------------------------- */
  const actions = document.createElement('div');
  actions.className = 'btn-row';

  const bEdit = document.createElement('button');
  bEdit.className = 'tab-btn btn-sm';
  bEdit.textContent = 'Modifier';
  bEdit.onclick = () => openEditSavedPatternModal(rec.uid);

  const bDel = document.createElement('button');
  bDel.className = 'tab-btn btn-sm danger';
  bDel.textContent = 'Supprimer';
  bDel.onclick = () => {
    deleteSavedPattern(rec.uid);
    const idTab = `saved-${rec.uid}`;
    if (Tabbed?.openTabs?.has(idTab)) closeTab(idTab);
  };

  actions.append(bEdit, bDel);
  panel.appendChild(actions);
}

























/*---------------------------------------
VUE DE COMPOSIITON
---------------------------------------*/

// --- Fragments spatiaux actuellement visibles selon zones + pas discours
// --- Fragments spatiaux actuellement visibles selon zones + critères actifs
function getCurrentlyVisibleSpatialFeatures() {
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];

  return all.filter(f => {
    if (!f || !f.properties) return false;
    if (f.properties.isDiscourse) return false;

    // 1) zones actives (Montreuil / Mirail)
    if (typeof isFeatureInActiveZones === 'function') {
      if (!isFeatureInActiveZones(f)) return false;
    }

    // 2) dimensions / masques (crit-dim)
    if (typeof getActiveMaskFor === 'function') {
      const m = getActiveMaskFor(f);
      if (!m) return false;           // masque nul → aucun critère actif → on cache
    }

    // 3) critères fuzzy (crit-key)
    if (!hasAnyActiveCriterion(f)) return false;

    return true;
  });
}


// --- Toutes les photos normalisées d’un feature (tableau de strings propres)
function allPhotosForFeature(f) {
  const list = normalizePhotos(f?.properties?.photos);
  return list.map(cleanPhotoUrl).filter(Boolean);
}

// --- Intersection de critères (masques) sur une liste d’IDs
function intersectCriteriaMasks(fragmentIds) {
  if (!fragmentIds.length) return 0;
  const byId = new Map(
    [...(dataGeojson || []), ...(datamGeojson || [])].map((f) => [
      f.properties.id,
      f,
    ])
  );
  let inter = null;
  fragmentIds.forEach((id) => {
    const f = byId.get(id);
    if (!f) return;
    const m = getActiveMaskFor(f); // tient compte des dimensions (légende) actives
    inter = inter === null ? m : inter & m;
  });
  return inter || 0;
}

// --- Prochain nom de pattern disponible (P{n}) pour affichage par défaut
function nextPatternName() {
  // on prend max sur patterns existants; si aucun => P1
  const nums = Object.keys(patterns || {})
    .map((k) => parseInt(String(k).replace(/^P/i, ""), 10))
    .filter((n) => Number.isFinite(n));
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return `P${n}`;
}


function computeFuzzySignatureForIds(ids) {
  // Retourne un dictionnaire : { critère: moyenne fuzzy ou null }
  const all = [...dataGeojson, ...datamGeojson];
  const byId = new Map(all.map(f => [f.properties.id, f]));

  const result = {};

  ALL_FUZZY_KEYS.forEach(k => {
    if (!ACTIVE_FUZZY_KEYS.has(k)) {
      result[k] = null;  // critère désactivé → ignoré
      return;
    }

    let sum = 0, count = 0;
    ids.forEach(id => {
      const f = byId.get(id);
      if (!f) return;
      const v = parseFuzzy(f.properties[k]);
      if (v !== null) {
        sum += v;
        count++;
      }
    });

    result[k] = count ? (sum / count) : null;
  });

  return result;
}


function showGalleryComposeView() {
  const host = document.getElementById("gallery-compose-view");
  host.innerHTML = "";

  /* --- marge interne haute/basse directement sur le host --- */
  host.style.boxSizing = "border-box";
  host.style.overflow = "hidden"; // on scrolle dans les boîtes, pas le host
  host.style.paddingTop = "12px"; // ↑ air en haut
  host.style.paddingBottom = "28px"; // ↓ air en bas pour ne pas toucher le bord

  // cacher le slider sur cette vue
  const sliderBox = document.getElementById("similarity-controls");
  if (sliderBox) sliderBox.style.display = "none";

  /* ===== Layout : [barre] [sources] [composition] ===== */
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "display:grid",
    "grid-template-rows:auto 1fr 1fr",
    "gap:8px",
    "height:100%",
    "min-height:0",
    "box-sizing:border-box",
    // on soustrait un petit offset pour respecter le padding-bottom du host
    "height:calc(100% - 10px)",
  ].join(";");

  /* ---------- (1) BARRE D’INFOS ---------- */
  const infoBar = document.createElement("div");
  infoBar.style.cssText = [
    "display:flex",
    "justify-content:space-between",
    "align-items:center",
    "padding:4px 8px",
    "line-height:1.2",
    "min-height:20px",
    "max-height:30px",
    "overflow:hidden",
  ].join(";");

  const leftInfo = document.createElement("div");
  leftInfo.style.cssText =
    "font-size:12px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  const rightInfo = document.createElement("div");
  rightInfo.style.cssText = "display:flex;gap:8px;";
  infoBar.append(leftInfo, rightInfo);

  /* ---------- (2) SOURCES ---------- */
  const sourceShell = document.createElement("div");
  sourceShell.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "border:1px solid #000",
    "background:#fcfcfc",
    "padding:8px",
    "min-height:0",
    "box-sizing:border-box",
    "overflow:hidden",
  ].join(";");

  const sourceScroll = document.createElement("div");
  sourceScroll.style.cssText =
    "flex:1 1 0; min-height:0; overflow:auto; box-sizing:border-box;";
  const sourceGrid = document.createElement("div");
  sourceGrid.style.cssText =
    "display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px;";
  sourceScroll.appendChild(sourceGrid);
  sourceShell.appendChild(sourceScroll);

  /* ---------- (3) COMPOSITION ---------- */
  const composeRow = document.createElement("div");
  composeRow.style.cssText = [
    "display:grid",
    "grid-template-columns:minmax(0,1fr) 220px",
    "gap:12px",
    "height:75%",
    "min-height:0",
    "overflow:hidden",
    "margin-bottom: 10px", // petit air avant le bas du host
  ].join(";");

  const dropShell = document.createElement("div");
  dropShell.style.cssText =
    "display:flex; flex-direction:column; min-height:0;";

  const dropScroll = document.createElement("div");
  dropScroll.id = "pattern-dropzone";
  dropScroll.style.cssText = [
    "flex:1 1 0",
    "min-height:0",
    "overflow:auto",
    "border:1px dashed #000000ff",
    "background:#fff",
    "padding:10px",
    "box-sizing:border-box",
  ].join(";");

  const dropGrid = document.createElement("div");
  dropGrid.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";
  dropScroll.appendChild(dropGrid);
  dropShell.appendChild(dropScroll);

  const actionsCol = document.createElement("div");
  actionsCol.style.cssText =
    "display:flex; flex-direction:column; gap:8px; align-self:start; position:sticky; top:0;";

  // Boutons
  const btnSave = document.createElement("button");
  btnSave.className = "tab-btn";
  btnSave.textContent = "Enregistrer ce pattern";
  btnSave.style.cssText =
    "background:#000;color:#fff;padding:8px;border:1px solid #000;cursor:pointer;border-radius:0;";

  const btnClear = document.createElement("button");
  btnClear.className = "tab-btn";
  btnClear.textContent = "Vider la composition";
  btnClear.style.cssText =
    "padding:8px;border:1px solid #000;cursor:pointer;background:#000;border-radius:0;";

  actionsCol.append(btnSave, btnClear);
  composeRow.append(dropShell, actionsCol);

  // montage
  wrap.append(infoBar, sourceShell, composeRow);
  host.appendChild(wrap);

  /* ===== Logique ===== */
  const composition = [];
  const uniqueFragmentIds = () =>
    Array.from(new Set(composition.map((x) => x.id)));

function refreshInfoBar() {
  const ids = uniqueFragmentIds();

  if (!ids.length) {
    leftInfo.textContent = `Glisse des images ci-dessous pour composer.`;
    return;
  }

  // --- 1) Calcul consensus fuzzy (déjà existant)
  const consens = computeConsensusCriteriaForIds(ids);
  const sharedCount = Object.entries(consens)
    .filter(([_, v]) => v !== null && v >= 0.2)
    .length;

  // --- 2) SIMILARITÉ MOYENNE ENTRE TOUS LES FRAGMENTS ---
  const all = [...(dataGeojson || []), ...(datamGeojson || [])];
  const byId = new Map(all.map(f => [f.properties.id, f]));

  const vecs = ids
    .map(id => featureToVector(byId.get(id)))
    .filter(v => v !== null);

  let sum = 0, count = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      sum += similarityFuzzy(vecs[i], vecs[j]);
      count++;
    }
  }

  const avgSim = count ? (sum / count) : 0;
  const simPct = Math.round(avgSim * 100);

  // --- 3) Affichage
  leftInfo.textContent =
  `Fragments : ${ids.length} — Similarité : ${simPct}%`;
}




  function renderDropGrid() {
    dropGrid.innerHTML = "";
    composition.forEach((item, idx) => {
      const card = document.createElement("div");
      card.style.cssText =
        "position:relative;width:120px;height:90px;border:1px solid #ddd;overflow:hidden;background:#eee;";
      const img = document.createElement("img");
      img.src = item.photo;
      img.alt = item.id;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;";
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "Retirer";
      del.style.cssText =
        "position:absolute;top:2px;right:2px;background:#000;color:#fff;border:none;width:22px;height:22px;cursor:pointer;border-radius:0;";
      del.onclick = () => {
        composition.splice(idx, 1);
        renderDropGrid();
        refreshInfoBar();
      };
      card.append(img, del);
      dropGrid.appendChild(card);
    });
  }

  dropScroll.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropScroll.style.borderColor = "#000";
  });
  dropScroll.addEventListener("dragleave", () => {
    dropScroll.style.borderColor = "#bdbdbd";
  });
  dropScroll.addEventListener("drop", (e) => {
    e.preventDefault();
    dropScroll.style.borderColor = "#bdbdbd";
    try {
      const payload = JSON.parse(e.dataTransfer.getData("application/json"));
      if (payload?.id && payload?.photo) {
        composition.push({ id: payload.id, photo: payload.photo });
        renderDropGrid();
        refreshInfoBar();
      }
    } catch (_) {}
  });

  function populateSourceGrid() {
    sourceGrid.innerHTML = "";
    const visibles = getCurrentlyVisibleSpatialFeatures();
    visibles.forEach((f) => {
      const fid = f.properties.id;
      const photos = allPhotosForFeature(f);
      photos.forEach((photo) => {
        const cell = document.createElement("div");
        cell.style.cssText =
          "border:none;overflow:hidden;background:transparent;";
        const img = document.createElement("img");
        img.src = photo;
        img.alt = f.properties.name || fid || "fragment";
        img.draggable = true;
        img.style.cssText =
          "display:block;width:100%;aspect-ratio:4/3;object-fit:cover;cursor:grab;";
        img.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData(
            "application/json",
            JSON.stringify({ id: fid, photo })
          );
          e.dataTransfer.effectAllowed = "copy";
        });
        img.addEventListener("click", () => showDetails(f.properties));
        cell.appendChild(img);
        sourceGrid.appendChild(cell);
      });
    });
  }

  // Permet de rafraîchir la liste des sources depuis l'extérieur (crit-key)
  window.__refreshGalleryComposeSources = function () {
    if (currentView === "gallery-compose") {
      populateSourceGrid();
      refreshInfoBar();
    }
  };



  btnClear.onclick = () => {
    composition.splice(0, composition.length);
    renderDropGrid();
    refreshInfoBar();
  };
  btnSave.onclick = () => {
    const ids = uniqueFragmentIds();
    if (!ids.length) {
      alert(
        "Ajoute au moins un fragment dans la composition avant d'enregistrer."
      );
      return;
    }
    const criteria = computeFuzzySignatureForIds(ids);
    const pKey = nextPatternName();
    openPatternEditor({
      mode: "create",
      patternKey: pKey,
      elements: ids,
      criteria,
      name: pKey,
      description: "",
      onSave: (payload) => {
        const rec = {
          uid:
            "sp_" +
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 7),
          ...payload,
          savedAt: new Date().toISOString(),
        };
        addSavedPattern(rec);
        openSavedPatternPanel(rec.uid);
      },
      headerText: "Enregistrer ce pattern (composition)",
      saveText: "Enregistrer",
    });
  };

  populateSourceGrid();
  renderDropGrid();
  refreshInfoBar();

  document.querySelectorAll(".filter-zone").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (currentView === "gallery-compose") populateSourceGrid();
    });
  });
  document.querySelectorAll("#criteria-legend .crit-dim").forEach((cb) => {
    cb.addEventListener("change", () => {
      rebuildCriteriaEnabledMaskFromUI();
      if (currentView === "gallery-compose") {
        populateSourceGrid();
        refreshInfoBar();
      }
    });
  });
}






/*==================================================
=                    ANALOGIES                     =
==================================================*/

const ANAL_SAVE_KEY = "analogiesV1";
let Anal = {
  inited: false,
  els: {
    view: null,
    railList: null,
    railSearch: null,
    railFilterBtn: null,
    board: null,
    cells: [],
    title: null,
    btnNew: null,
    btnSave: null,
    btnOpen: null,
    btnExport: null,
    fileInput: null,
    savedModal: null,
    savedBody: null,
    savedClose: null,
  },
  state: {
    // 4 cases : { kind:'fragment'|'image'|'note'|null, data:{...}, overlays?:[{id,x,y,text}] }
    cells: [{ kind: null }, { kind: null }, { kind: null }, { kind: null }],
    title: "",
  },
  pendingImportSlot: null,
  dragLabel: {
    active: false,
    slot: null,
    id: null,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  }, // drag des labels
};

function initAnalogiesOnce() {
  if (Anal.inited) return;

  // --- capture DOM
  Anal.els.view = document.getElementById("analogies-view");
  Anal.els.railList = document.getElementById("anal-rail-list");
  Anal.els.railSearch = document.getElementById("anal-rail-search");
  Anal.els.board = document.getElementById("anal-board");
  Anal.els.title = document.getElementById("anal-title-input");
  Anal.els.btnNew = document.getElementById("anal-new-btn");
  Anal.els.btnSave = document.getElementById("anal-save-btn");
  Anal.els.btnOpen = document.getElementById("anal-open-btn");
  Anal.els.btnExport = document.getElementById("anal-export-btn");
  Anal.els.fileInput = document.getElementById("anal-file-input");
  Anal.els.savedModal = document.getElementById("anal-saved-modal");
  Anal.els.savedBody = document.getElementById("anal-saved-body");
  Anal.els.savedClose = document.getElementById("anal-saved-close");

  // --- style cadran 2x2 noir épais, sans arrondis
  if (Anal.els.board) {
    Anal.els.board.style.cssText = [
      "display:grid",
      "grid-template-columns:1fr 1fr",
      "grid-template-rows:1fr 1fr",
      "gap:0",
      "border:4px solid #000",
      "background:#fff", // fonds neutre
      "border-radius:0",
      "overflow:hidden",
    ].join(";");
  }

  // Hauteur du cadran : ajuste si tu veux un autre ratio (ici 4/3 paysage)
  const h = Math.max(420, Math.min(window.innerHeight * 0.7, 720));
  Anal.els.board.style.height = h + "px";
  Anal.els.board.style.width = h * 1.3333 + "px"; // 4/3 = paysage
  Anal.els.board.style.maxWidth = "80vw";
  Anal.els.board.style.margin = "0 auto"; // centre horizontalement

  // 4 cellules
  Anal.els.cells = Array.from(Anal.els.board.querySelectorAll(".anal-cell"));
  // pose les bordures internes épaisses pour un quadrillage net
  Anal.els.cells.forEach((cell, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    cell.style.border = "0"; // reset
    cell.style.borderRadius = "0";
    cell.style.position = "relative";
    cell.style.overflow = "hidden"; // ⇦ empêche l’agrandissement
    cell.style.minHeight = "0"; // important pour les grilles
    cell.style.display = "block"; // pas de layout flex qui pousse
    // traits internes (4px noirs) : bas pour la première rangée, droite pour la première colonne
    if (row === 0) cell.style.borderBottom = "4px solid #000";
    if (col === 0) cell.style.borderRight = "4px solid #000";
  });

  // --- listeners rail
  Anal.els.railSearch.addEventListener(
    "input",
    debounce(renderAnalogiesRail, 120)
  );
  Anal.els.railFilterBtn?.addEventListener("click", () => {
    document.getElementById("toggle-legend-btn")?.click?.();
  });

  // --- listeners board
  Anal.els.cells.forEach((cell) => wireAnalogiesCell(cell));

  // --- toolbar
  Anal.els.btnNew.addEventListener("click", () => {
    if (!confirm("Créer une nouvelle carte et vider les 4 cases ?")) return;
    resetAnalogiesBoard();
  });

  Anal.els.btnSave.addEventListener("click", () => {
    const rec = serializeAnalogy();
    if (!rec.title.trim()) {
      alert("Donne un titre à la carte avant d’enregistrer.");
      Anal.els.title.focus();
      return;
    }
    addSavedAnalogy(rec);
    alert("Carte enregistrée en local.");
  });

  Anal.els.btnOpen.addEventListener("click", openAnalogiesSavedModal);
  Anal.els.btnExport.addEventListener("click", () => {
    const rec = serializeAnalogy();
    const blob = new Blob([JSON.stringify(rec, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (rec.title || "analogie") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // input fichier unique partagé
  Anal.els.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || Anal.pendingImportSlot == null) return;
    const dataUrl = await fileToDataURL(file);
    setCellContent(Anal.pendingImportSlot, {
      kind: "image",
      data: { dataUrl, name: file.name || "image" },
      overlays: [],
    });
    Anal.pendingImportSlot = null;
  });

  // collage (presse-papiers) : si une case a le focus, on la vise; sinon, dernière focale
  Anal.els.view.addEventListener("paste", async (e) => {
    const targetCell = e.target.closest?.(".anal-cell");
    const slot = targetCell
      ? parseInt(targetCell.dataset.slot, 10)
      : findFocusedCellSlot();
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file") {
        const file = it.getAsFile();
        if (!file) continue;
        const dataUrl = await fileToDataURL(file);
        setCellContent(slot ?? 0, {
          kind: "image",
          data: { dataUrl, name: file.name || "pasted" },
          overlays: [],
        });
        e.preventDefault();
        return;
      } else if (it.kind === "string") {
        it.getAsString((txt) => {
          const t = (txt || "").trim();
          if (t) setCellContent(slot ?? 0, { kind: "note", data: { text: t } });
        });
        e.preventDefault();
        return;
      }
    }
  });

  // drag global des labels (pour éviter sélection involontaire)
  window.addEventListener("mousemove", onLabelDragMove);
  window.addEventListener("mouseup", onLabelDragEnd);

  // réagir aux filtres de zones → rail
  document.querySelectorAll(".filter-zone").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (currentView === "analogies") renderAnalogiesRail();
    });
  });

  // init
  renderAnalogiesRail();
  resetAnalogiesBoard();
  Anal.inited = true;
}

function showAnalogiesView() {
  renderAnalogiesRail();
}

/* ------------ RAIL (vignettes de fragments) ------------- */

function renderAnalogiesRail() {
  if (!Anal.els.railList) return;
  Anal.els.railList.innerHTML = "";

  const q = (Anal.els.railSearch.value || "").toLowerCase().trim();
  const all = [...(dataGeojson || []), ...(datamGeojson || [])].filter(
    (f) => isFeatureInActiveZones(f) && !f.properties?.isDiscourse
  );

  all.forEach((f) => {
    const fid = f.properties.id;
    const name = (f.properties.name || "").toLowerCase();
    if (q && !fid.toLowerCase().includes(q) && !name.includes(q)) return;

    const photos = normalizePhotos(f.properties.photos)
      .map(cleanPhotoUrl)
      .filter(Boolean);
    const src = photos[0] || "";
    const card = document.createElement("div");
    card.className = "anal-thumb";
    card.style.cssText =
      "border:1px solid #000;background:#fff;overflow:hidden;border-radius:0;";

    const img = document.createElement("img");
    img.src =
      src ||
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    img.alt = f.properties.name || fid;
    img.loading = "lazy";
    img.style.cssText =
      "display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:0;";

    // drag payload (aucun titre/caption)
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({
          kind: "fragment",
          id: fid,
          photo: src,
          name: f.properties.name || fid,
        })
      );
      e.dataTransfer.effectAllowed = "copy";
    });
    card.addEventListener("click", () => showDetails(f.properties));

    card.append(img);
    Anal.els.railList.appendChild(card);
  });
}

/* ------------ CELLS (drop/import/paste/note + overlay texte) ------------- */

function wireAnalogiesCell(cell) {
  const slot = parseInt(cell.dataset.slot, 10);
  const contentEl = cell.querySelector(".anal-cell-content");
  const dropEl = cell.querySelector(".anal-cell-drop");
  const btnImport = cell.querySelector(".anal-cell-import");
  const btnClear = cell.querySelector(".anal-cell-clear");

  // fond neutre et angles vifs
  cell.style.background = "#fff";
  if (contentEl) {
    contentEl.style.position = "absolute";
    contentEl.style.inset = "0"; // top/right/bottom/left = 0
  }
  if (dropEl) {
    dropEl.style.position = "absolute";
    dropEl.style.inset = "0";
    dropEl.style.display = "flex";
    dropEl.style.alignItems = "center";
    dropEl.style.justifyContent = "center";
  }

  // DnD (toujours sur la case entière)
  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    cell.style.outline = "2px dashed #000";
  });
  cell.addEventListener("dragleave", () => {
    cell.style.outline = "none";
  });
  cell.addEventListener("drop", async (e) => {
    e.preventDefault();
    cell.style.outline = "none";
    const dt = e.dataTransfer;
    let jsonOk = false;
    try {
      const payload = JSON.parse(dt.getData("application/json") || "null");
      if (payload?.kind === "fragment" && payload.id) {
        setCellContent(slot, {
          kind: "fragment",
          data: {
            id: payload.id,
            photo: payload.photo || null,
            name: payload.name || payload.id,
          },
          overlays: [],
        });
        jsonOk = true;
      }
    } catch (_) {}
    if (jsonOk) return;
    if (dt.files && dt.files[0] && dt.files[0].type.startsWith("image/")) {
      const dataUrl = await fileToDataURL(dt.files[0]);
      setCellContent(slot, {
        kind: "image",
        data: { dataUrl, name: dt.files[0].name || "image" },
        overlays: [],
      });
      return;
    }
    const txt = dt.getData("text/plain");
    if (txt && txt.trim())
      setCellContent(slot, { kind: "note", data: { text: txt.trim() } });
  });

  // Import / Clear
  btnImport?.addEventListener("click", () => {
    Anal.pendingImportSlot = slot;
    Anal.els.fileInput.click();
  });
  btnClear?.addEventListener("click", () => clearCell(slot));

  // ⬇️ Double-clic sur TOUTE la case :
  // - image/fragment → ajoute un label à l’endroit cliqué
  // - note → focus texte
  // - vide → bascule en note
  cell.addEventListener("dblclick", (ev) => {
    // évite d’ajouter un label quand on double-clique sur un bouton / input / label existant
    if (
      ev.target.closest(".overlay-label") ||
      ev.target.closest(".tab-btn") ||
      ev.target.tagName === "TEXTAREA" ||
      ev.target.tagName === "INPUT"
    )
      return;

    const cur = Anal.state.cells[slot];

    // position du clic en % de la surface utile (overlay-layer si présent, sinon la case)
    const layer = cell.querySelector(".overlay-layer");
    const refEl = layer || cell;
    const rect = refEl.getBoundingClientRect();
    const xPct = Math.min(
      100,
      Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)
    );
    const yPct = Math.min(
      100,
      Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100)
    );

    if (cur?.kind === "image" || cur?.kind === "fragment") {
      addOverlayLabel(slot, { x: xPct, y: yPct, text: "Texte" });
    } else if (cur?.kind === "note") {
      const ta = cell.querySelector(".anal-cell-content textarea");
      if (ta) {
        ta.focus();
        ta.select();
      }
    } else {
      setCellContent(slot, { kind: "note", data: { text: "" } });
    }
  });
}

function setCellContent(slot, payload) {
  const cell = Anal.els.cells[slot];
  const contentEl = cell.querySelector(".anal-cell-content");
  const dropEl = cell.querySelector(".anal-cell-drop");
  contentEl.innerHTML = "";
  dropEl.style.display = "none";
  contentEl.style.position = "absolute";
  contentEl.style.inset = "0";

  // toolbar overlay : bouton 'Texte' pour ajouter un label
  function mountOverlayToolbar() {
    const tb = document.createElement("div");
    tb.style.cssText =
      "position:absolute;top:6px;left:6px;display:flex;gap:6px;z-index:5";
    const btnTxt = document.createElement("button");
    btnTxt.textContent = "Texte";
    btnTxt.className = "tab-btn btn-xs";
    btnTxt.style.cssText =
      "padding:3px 6px;border:1px solid #000;background:#fff;color:#000;border-radius:0;cursor:pointer";
    btnTxt.addEventListener("click", () =>
      addOverlayLabel(slot, { x: 50, y: 50, text: "Texte" })
    );
    tb.appendChild(btnTxt);
    contentEl.appendChild(tb);
  }

  // calque overlays
  function mountOverlayLayer() {
    let layer = contentEl.querySelector(".overlay-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "overlay-layer";
      layer.style.cssText = "position:absolute;inset:0;z-index:4";
      contentEl.appendChild(layer);
    }
    return layer;
  }

  Anal.state.cells[slot] = payload;

  if (payload.kind === "fragment" || payload.kind === "image") {
    const src =
      payload.kind === "fragment"
        ? payload.data.photo || ""
        : payload.data.dataUrl;
    const img = document.createElement("img");
    img.src =
      src ||
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    img.alt = payload.data.name || payload.data.id || "image";
    img.style.cssText =
      "display:block;width:100%;height:100%;object-fit:contain;object-position:center center;border:0;border-radius:0;user-select:none;";
    contentEl.appendChild(img);

    mountOverlayToolbar();
    const layer = mountOverlayLayer();
    layer.innerHTML = "";
    (payload.overlays || []).forEach((lbl) =>
      layer.appendChild(buildLabelEl(slot, lbl))
    );
  } else if (payload.kind === "note") {
    const ta = document.createElement("textarea");
    ta.value = payload.data.text || "";
    ta.rows = 8;
    ta.style.cssText =
      "width:100%;height:100%;box-sizing:border-box;resize:vertical;border:none;border-radius:0;padding:8px;";
    ta.addEventListener("input", () => {
      Anal.state.cells[slot].data.text = ta.value;
    });
    contentEl.appendChild(ta);
  } else {
    dropEl.style.display = "flex";
  }
}

/* ---------- Overlays texte (labels) ---------- */

function addOverlayLabel(slot, { x = 50, y = 50, text = "Texte" } = {}) {
  // x,y en pourcentage de la surface (0..100)
  const lbl = {
    id: "lbl_" + Math.random().toString(36).slice(2, 8),
    x,
    y,
    text,
  };
  const cellState = Anal.state.cells[slot];
  if (!cellState.overlays) cellState.overlays = [];
  cellState.overlays.push(lbl);

  const cell = Anal.els.cells[slot];
  const layer =
    cell.querySelector(".overlay-layer") ||
    (() => {
      const l = document.createElement("div");
      l.className = "overlay-layer";
      l.style.cssText = "position:absolute;inset:0;z-index:4";
      cell.querySelector(".anal-cell-content").appendChild(l);
      return l;
    })();
  layer.appendChild(buildLabelEl(slot, lbl));
}

function buildLabelEl(slot, lbl) {
  const el = document.createElement("div");
  el.className = "overlay-label";
  el.dataset.id = lbl.id;
  el.style.cssText = [
    "position:absolute",
    `left:calc(${lbl.x}% )`,
    `top:calc(${lbl.y}% )`,
    "transform:translate(-50%,-50%)",
    "min-width:40px",
    "max-width:80%",
    "padding:4px 8px",
    "border:1px solid #000",
    "background:#fff",
    "color:#000",
    "font-size:12px",
    "line-height:1.2",
    "cursor:move",
    "user-select:none",
    "border-radius:0",
    "box-shadow:none",
  ].join(";");

  const textEl = document.createElement("span");
  textEl.textContent = lbl.text || "Texte";
  textEl.style.display = "inline-block";
  textEl.style.cursor = "text";
  textEl.addEventListener("click", (e) => {
    e.stopPropagation();
    startInlineEdit(slot, lbl.id, textEl);
  });

  const close = document.createElement("button");
  close.textContent = "×";
  close.title = "Supprimer";
  close.style.cssText =
    "margin-left:6px;border:none;background:#fff;color:#000;width:18px;height:18px;line-height:14px;padding:0;cursor:pointer;border-radius:0;";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    removeOverlayLabel(slot, lbl.id);
  });

  // drag
  el.addEventListener("mousedown", (e) => {
    if (e.target === close) return;
    Anal.dragLabel = {
      active: true,
      slot,
      id: lbl.id,
      startX: e.clientX,
      startY: e.clientY,
      baseX: lbl.x,
      baseY: lbl.y,
    };
    e.preventDefault();
  });

  el.append(textEl, close);
  return el;
}

function startInlineEdit(slot, id, spanEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = spanEl.textContent || "";
  input.style.cssText =
    "border:1px solid #000;padding:2px 4px;width:200px;max-width:60vw;border-radius:0;";
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const val = (input.value || "").trim();
    const cell = Anal.state.cells[slot];
    const lbl = (cell.overlays || []).find((o) => o.id === id);
    if (lbl) lbl.text = val || "Texte";
    const newSpan = document.createElement("span");
    newSpan.textContent = lbl ? lbl.text : "";
    newSpan.style.display = "inline-block";
    newSpan.style.cursor = "text";
    newSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      startInlineEdit(slot, id, newSpan);
    });
    input.replaceWith(newSpan);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
  });
}

function removeOverlayLabel(slot, id) {
  const cell = Anal.state.cells[slot];
  cell.overlays = (cell.overlays || []).filter((o) => o.id !== id);
  const layer = Anal.els.cells[slot].querySelector(".overlay-layer");
  layer?.querySelector(`[data-id="${id}"]`)?.remove();
}

function onLabelDragMove(e) {
  const d = Anal.dragLabel;
  if (!d.active) return;
  const cell = Anal.els.cells[d.slot];
  const layer = cell.querySelector(".overlay-layer");
  if (!layer) return;

  const rect = layer.getBoundingClientRect();
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const newX = Math.min(100, Math.max(0, d.baseX + (dx / rect.width) * 100));
  const newY = Math.min(100, Math.max(0, d.baseY + (dy / rect.height) * 100));

  // maj state
  const cellState = Anal.state.cells[d.slot];
  const lbl = (cellState.overlays || []).find((o) => o.id === d.id);
  if (lbl) {
    lbl.x = newX;
    lbl.y = newY;
  }

  // maj DOM
  const el = layer.querySelector(`[data-id="${d.id}"]`);
  if (el) {
    el.style.left = `${newX}%`;
    el.style.top = `${newY}%`;
  }
}

function onLabelDragEnd() {
  Anal.dragLabel.active = false;
}

/* ------------ gestion vide/reset/clear ------------- */

function clearCell(slot) {
  Anal.state.cells[slot] = { kind: null };
  const cell = Anal.els.cells[slot];
  cell.querySelector(".anal-cell-content").innerHTML = "";
  cell.querySelector(".anal-cell-drop").style.display = "flex";
}

function resetAnalogiesBoard() {
  Anal.els.title.value = "";
  Anal.state.title = "";
  for (let i = 0; i < 4; i++) clearCell(i);
}

/* ------------ Sauvegarde / Ouverture ------------- */

function serializeAnalogy() {
  Anal.state.title = Anal.els.title.value || "";
  // on copie un payload “léger”, y compris les overlays (pour image/fragment)
  const cells = Anal.state.cells.map((c) => {
    if (!c || !c.kind) return { kind: null };
    if (c.kind === "image")
      return {
        kind: "image",
        data: { dataUrl: c.data.dataUrl || "" },
        overlays: c.overlays || [],
      };
    if (c.kind === "fragment")
      return {
        kind: "fragment",
        data: { id: c.data.id, photo: c.data.photo || null },
        overlays: c.overlays || [],
      };
    if (c.kind === "note")
      return { kind: "note", data: { text: c.data.text || "" } };
    return { kind: null };
  });
  return {
    uid:
      "an_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: Anal.state.title,
    cells,
    savedAt: new Date().toISOString(),
  };
}

function addSavedAnalogy(rec) {
  const arr = loadSavedAnalogies();
  arr.push(rec);
  localStorage.setItem(ANAL_SAVE_KEY, JSON.stringify(arr));
}
function loadSavedAnalogies() {
  try {
    return JSON.parse(localStorage.getItem(ANAL_SAVE_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
function deleteSavedAnalogy(uid) {
  const arr = loadSavedAnalogies().filter((x) => x.uid !== uid);
  localStorage.setItem(ANAL_SAVE_KEY, JSON.stringify(arr));
}

function openAnalogiesSavedModal() {
  const m = Anal.els.savedModal;
  const body = Anal.els.savedBody;
  const close = Anal.els.savedClose;
  if (!m || !body) return;

  body.innerHTML = "";
  const items = loadSavedAnalogies()
    .slice()
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  if (!items.length) {
    body.innerHTML =
      '<div style="color:#aaa">Aucune carte d’analogies enregistrée.</div>';
  } else {
    items.forEach((rec) => {
      const card = document.createElement("div");
      card.style.cssText =
        "border:1px solid #000;padding:10px;margin-bottom:8px;color:#000;background:#fff;border-radius:0;";
      const h = document.createElement("div");
      h.style.fontWeight = "700";
      h.textContent = rec.title || "(sans titre)";
      const meta = document.createElement("div");
      meta.style.cssText = "color:#333;font-size:12px;margin:4px 0 8px";
      meta.textContent = `Sauvé le ${fmtDate(rec.savedAt)}`;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
      const bOpen = document.createElement("button");
      bOpen.className = "tab-btn btn-sm primary";
      bOpen.textContent = "Ouvrir";
      bOpen.style.cssText =
        "border:1px solid #000;background:#fff;color:#000;border-radius:0;";
      bOpen.onclick = () => {
        m.style.display = "none";
        loadAnalogyIntoBoard(rec);
      };
      const bDel = document.createElement("button");
      bDel.className = "tab-btn btn-sm danger";
      bDel.textContent = "Supprimer";
      bDel.style.cssText =
        "border:1px solid #000;background:#000;color:#fff;border-radius:0;";
      bDel.onclick = () => {
        deleteSavedAnalogy(rec.uid);
        openAnalogiesSavedModal();
      };
      row.append(bOpen, bDel);
      card.append(h, meta, row);
      body.appendChild(card);
    });
  }

  close.onclick = () => {
    m.style.display = "none";
  };
  m.querySelector(".modal__backdrop")?.addEventListener(
    "click",
    () => (m.style.display = "none")
  );
  m.style.display = "block";
}

function loadAnalogyIntoBoard(rec) {
  resetAnalogiesBoard();
  Anal.els.title.value = rec.title || "";
  Anal.state.title = rec.title || "";
  (rec.cells || []).forEach((c, i) => {
    if (!c || !c.kind) return;
    setCellContent(i, c);
  });
}

/* ------------ Utils ------------- */

function findFocusedCellSlot() {
  const el = document.activeElement;
  const cell = el?.closest?.(".anal-cell");
  return cell ? parseInt(cell.dataset.slot, 10) : null;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
