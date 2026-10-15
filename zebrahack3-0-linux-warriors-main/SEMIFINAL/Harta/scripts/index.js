const API_BASE_URL = 'https://zebrahack.iqnox.tech/api';
const API_KEY = 'Linux Warriors'; 

let map = null;
let debounceTimer = null;
let popupElement = null;

let isLockedOnPoint = false; 

const ROMANIA_BOUNDS = [
    [20.0, 43.5], 
    [30.0, 48.5]  
];

const SIDEBAR_ZOOM_THRESHOLD = 9;

const safeParseFloat = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const cleanVal = val.replace(/\s/g, '').replace(',', '.');
        const num = parseFloat(cleanVal);
        return isNaN(num) ? 0 : num;
    }
    return 0;
};

const getBufferedBbox = () => {
    if (!map) return null;
    const bounds = map.getBounds();
    let swLng = bounds.getSouthWest().lng, swLat = bounds.getSouthWest().lat;
    let neLng = bounds.getNorthEast().lng, neLat = bounds.getNorthEast().lat;
    const latSpan = neLat - swLat, lngSpan = neLng - swLng;
    swLng -= lngSpan * 0.2; swLat -= latSpan * 0.2;
    neLng += lngSpan * 0.2; neLat += latSpan * 0.2;
    return `${swLng},${swLat},${neLng},${neLat}`;
};

const refreshData = async () => {
    if (!map) return;
    await fetchHeatmapData();

    if (isLockedOnPoint) return; 

    if (map.getZoom() >= SIDEBAR_ZOOM_THRESHOLD) {
        await fetchTransports();
    } else {
        showZoomMessageInSidebar();
    }
};

const fetchHeatmapData = async () => {
    try {
        const zoom = Math.floor(map.getZoom());
        const bbox = getBufferedBbox();
        if (!bbox) return;
        const url = `${API_BASE_URL}/heatmap?zoom=${zoom}&bbox=${bbox}`;
        const response = await fetch(url, { headers: { 'X-App-Key': API_KEY } });
        if (response.ok) {
            const data = await response.json();
            if (data?.features) updateHeatmapLayer(data);
        }
    } catch (e) { console.warn('Heatmap error', e); }
};

const updateHeatmapLayer = (geojsonData) => {
    if (!map) return;
    const source = map.getSource('heatmap-source');
    if (source) {
        source.setData(geojsonData);
    } else {
        map.addSource('heatmap-source', { type: 'geojson', data: geojsonData });
        map.addLayer({
            id: 'heatmap-layer', type: 'heatmap', source: 'heatmap-source', maxzoom: 15,
            paint: {
                'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1, 1],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, '#0d9488', 0.6, '#facc15', 1.0, '#ef4444'],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 20, 15, 50],
                'heatmap-opacity': 0.85
            }
        });
        map.addLayer({
            id: 'heatmap-click-layer', type: 'circle', source: 'heatmap-source',
            paint: { 'circle-radius': 25, 'circle-opacity': 0, 'circle-stroke-width': 0 }
        });
        map.on('mouseenter', 'heatmap-click-layer', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'heatmap-click-layer', () => map.getCanvas().style.cursor = '');
        map.on('click', 'heatmap-click-layer', handleHotspotClick);
    }
};

const handleHotspotClick = (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['heatmap-click-layer'] });
    if (!features.length) return;

    isLockedOnPoint = true; 
    const props = features[0].properties;
    
    let operators = [];
    try {
        operators = typeof props.operators === 'string' ? JSON.parse(props.operators) : (props.operators || []);
    } catch(e) { operators = []; }

    const normalizedCompanies = operators.map(op => ({
        id: (op.name || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_'),
        name: op.name,
        count: op.count || op.transports || 0,
        isEmitent: false, isDestinatar: false 
    })).sort((a,b) => b.count - a.count);

    document.getElementById('feed-count').innerHTML = `<span style="color: #e4e3de;">PUNCT SELECTAT</span>`;
    renderCompanies(normalizedCompanies);
    
    map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 10), speed: 1.5 });
};

const showZoomMessageInSidebar = () => {
    const list = document.getElementById('transports-list');
    document.getElementById('feed-count').textContent = "---";
    list.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#64748b;"><i class="fas fa-search-plus" style="font-size:32px;margin-bottom:15px;"></i><p>Dă Zoom In pentru companii.</p></div>`;
};

const fetchTransports = async () => {
    if (isLockedOnPoint) return;
    const list = document.getElementById('transports-list');
    const bbox = getBufferedBbox();
    
    list.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8;"><i class="fas fa-circle-notch fa-spin"></i> Se încarcă zona...</div>`;

    try {
        const url = `${API_BASE_URL}/area/companies/transports?bbox=${bbox}`;
        const response = await fetch(url, { headers: { 'X-App-Key': API_KEY } });
        if (!response.ok) throw new Error('Err');
        const data = await response.json();
        
        const grouped = groupBasicTransports(data.transports || []);
        renderCompanies(grouped);
    } catch (error) {
        list.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444;">Eroare date.</div>`;
    }
};

const groupBasicTransports = (transports) => {
    const map = {};
    transports.forEach(t => {
        const name = t.company_name || t.operator || t.emitent || 'Necunoscut';
        const role = (t.role || '').toLowerCase();

        if (!map[name]) {
            map[name] = {
                id: name.replace(/[^a-zA-Z0-9]/g, '_'),
                name: name,
                count: 0,
                isEmitent: false, isDestinatar: false
            };
        }
        map[name].count++;
        if (role === 'emitent') map[name].isEmitent = true;
        if (role === 'destinatar' || role === 'receptor') map[name].isDestinatar = true;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
};

const renderCompanies = (companies) => {
    const list = document.getElementById('transports-list');
    if (!isLockedOnPoint) document.getElementById('feed-count').textContent = `${companies.length} companii`;

    if (!companies.length) {
        list.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8;">Nicio companie.</div>`;
        return;
    }

    list.innerHTML = companies.map(comp => {
        let borderColor = '#64748b';
        if (comp.isEmitent && comp.isDestinatar) borderColor = '#a855f7';
        else if (comp.isEmitent) borderColor = '#10b981';
        else if (comp.isDestinatar) borderColor = '#3b82f6';
        
        return `
            <div 
                id="comp-el-${comp.id}"
                onclick="handleCompanyClick('${comp.id}', '${comp.name.replace(/'/g, "\\'")}')"
                style="
                    position: relative; 
                    background: rgba(30, 41, 59, 0.6);
                    border-left: 4px solid ${borderColor};
                    margin-bottom: 8px;
                    padding: 12px;
                    border-radius: 4px;
                    display: flex; justify-content: space-between; align-items: center;
                    transition: background 0.2s; cursor: pointer;
                " 
                onmouseover="this.style.background='rgba(30, 41, 59, 0.9)'" 
                onmouseout="this.style.background='rgba(30, 41, 59, 0.6)'"
            >
                <div>
                    <div style="font-weight: 700; color: #f1f5f9; font-size: 14px; margin-bottom: 4px;">
                        ${comp.name}
                    </div>
                    <div>
                         ${comp.isEmitent ? '<span style="font-size:10px;padding:2px 6px;background:rgba(16,185,129,0.2);color:#10b981;border-radius:3px;margin-right:4px;">EMITENT</span>' : ''}
                         ${comp.isDestinatar ? '<span style="font-size:10px;padding:2px 6px;background:rgba(59,130,246,0.2);color:#3b82f6;border-radius:3px;">DESTINATAR</span>' : ''}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 18px; font-weight: bold; color: #fff;">${comp.count}</div>
                    <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">transp.</div>
                </div>
            </div>
        `;
    }).join('');
};

const handleCompanyClick = async (id, companyName) => {
    const element = document.getElementById(`comp-el-${id}`);
    if (!element) return;

    showPopup(element, { name: companyName, loading: true });

    try {
        const stats = await fetchCompanyInsights(companyName);
        
        showPopup(element, {
            name: companyName,
            loading: false,
            stats: stats
        });

    } catch (error) {
        console.error("Eroare insights:", error);
        showPopup(element, { name: companyName, error: true });
    }
};

const fetchCompanyInsights = async (companyName) => {
    const encodedName = encodeURIComponent(companyName);
    
    const url = `${API_BASE_URL}/insights?company[]=${encodedName}&days=30`; 

    const response = await fetch(url, { headers: { 'X-App-Key': API_KEY } });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    
    const json = await response.json();
    
    let totalVolume = 0;
    let totalTransports = 0;
    let speciesMap = {};

    if (json.species && Array.isArray(json.species)) {
        json.species.forEach(s => {
            totalVolume += safeParseFloat(s.volume);
            totalTransports += (s.transports || 0);
            speciesMap[s.name] = (speciesMap[s.name] || 0) + safeParseFloat(s.volume);
        });
    } else if (json.daily) {
        json.daily.forEach(d => {
            totalVolume += safeParseFloat(d.volume);
            totalTransports += (d.transports || 0);
        });
    }

    const topSpecies = Object.entries(speciesMap)
        .sort(([, volA], [, volB]) => volB - volA)
        .slice(0, 3)
        .map(([name]) => name)
        .join(', ');

    return {
        volume: totalVolume,
        transports: totalTransports,
        species: topSpecies || 'Nespecificat',
        lookback: json.lookback_days || 30
    };
};

const showPopup = (element, data) => {
    if (!popupElement) {
        popupElement = document.createElement('div');
        popupElement.className = 'company-popup';
        Object.assign(popupElement.style, {
            position: 'fixed', zIndex: '9999', 
            background: '#0f172a',
            border: '1px solid #334155', 
            borderRadius: '8px', padding: '16px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)', 
            width: '280px', color: '#f8fafc',
            fontFamily: '"Roboto", sans-serif',
            display: 'none'
        });
        document.body.appendChild(popupElement);
        
        document.addEventListener('click', (e) => {
            if (popupElement.style.display === 'block' && 
                !popupElement.contains(e.target) && 
                !e.target.closest('[id^="comp-el-"]')) {
                popupElement.style.display = 'none';
            }
        });
    }

    let content = '';

    if (data.loading) {
        content = `
            <div style="text-align:center; padding: 15px;">
                <i class="fas fa-circle-notch fa-spin" style="color:#3b82f6; font-size:24px;"></i>
                <div style="margin-top:10px; color:#94a3b8; font-size:12px;">Se analizează datele...</div>
            </div>
        `;
    } else if (data.error) {
        content = `
            <div style="color:#ef4444; font-size:13px; text-align:center; padding: 10px;">
                <i class="fas fa-exclamation-triangle"></i> Eșec la preluarea datelor.
            </div>
        `;
    } else {
        content = `
            <div style="margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 8px;">
                <div style="font-size: 10px; color: #94a3b8; letter-spacing: 0.5px; text-transform: uppercase;">RAPORT (ULTIMELE ${data.stats.lookback} ZILE)</div>
                <div style="font-weight: 700; color: #f1f5f9; font-size: 15px; margin-top:2px; word-wrap: break-word;">${data.name}</div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                <div style="background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2);">
                    <div style="font-size: 10px; color: #6ee7b7; text-transform: uppercase;">Volum Total</div>
                    <div style="font-size: 16px; font-weight: bold; color: #10b981;">${data.stats.volume.toFixed(0)} <span style="font-size:10px">m³</span></div>
                </div>
                <div style="background: rgba(59, 130, 246, 0.1); padding: 8px; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.2);">
                    <div style="font-size: 10px; color: #93c5fd; text-transform: uppercase;">Transporturi</div>
                    <div style="font-size: 16px; font-weight: bold; color: #3b82f6;">${data.stats.transports}</div>
                </div>
            </div>

            <div style="background: #1e293b; padding: 8px; border-radius: 4px;">
                <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">Predominant:</div>
                <div style="color: #e2e8f0; font-size: 12px; font-style: italic;">
                    <i class="fas fa-tree" style="color: #22c55e; margin-right:4px;"></i> ${data.stats.species}
                </div>
            </div>
        `;
    }

    popupElement.innerHTML = content;

    const rect = element.getBoundingClientRect();
    let leftPos = rect.left - 300; 
    let topPos = rect.top;
    
    if (topPos + popupElement.offsetHeight > window.innerHeight) {
        topPos = window.innerHeight - popupElement.offsetHeight - 20;
    }
    if (topPos < 10) topPos = 10;

    popupElement.style.left = `${leftPos}px`;
    popupElement.style.top = `${topPos}px`;
    popupElement.style.display = 'block';
};

const initMap = () => {
    map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [25.0, 46.0], 
        zoom: 7,
        maxBounds: ROMANIA_BOUNDS, 
        minZoom: 6
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', refreshData);
    
    map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['heatmap-click-layer'] });
        
        if (features.length === 0) {
            if (popupElement) popupElement.style.display = 'none';

            if (isLockedOnPoint) {
                isLockedOnPoint = false;
                refreshData(); 
            }
        }
    });

    map.on('moveend', () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(refreshData, 500); 
    });
};

document.addEventListener('DOMContentLoaded', initMap);