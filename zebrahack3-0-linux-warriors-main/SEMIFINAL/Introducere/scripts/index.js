const API_BASE_URL = 'https://zebrahack.iqnox.tech/api';
const API_KEY = 'Linux Warriors';

let map = null;
let heatmapSource = null;
let transportsData = [];

const getBbox = () => {
    if (!map) return null;
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
};

const fetchHeatmapData = async () => {
    if (!map) return;
    
    const zoom = Math.floor(map.getZoom());
    const bbox = getBbox();
    
    if (!bbox) return;

    try {
        const url = `${API_BASE_URL}/heatmap?zoom=${zoom}&bbox=${bbox}`;
        const response = await fetch(url, {
            headers: {
                'X-App-Key': API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (data && data.features && Array.isArray(data.features)) {
            updateHeatmapLayer(data);
        }
    } catch (error) {
        console.error('Error fetching heatmap data:', error);
    }
};

const updateHeatmapLayer = (geojsonData) => {
    if (!map) return;

    if (heatmapSource) {
        heatmapSource.setData(geojsonData);
    } else {
        heatmapSource = {
            type: 'geojson',
            data: geojsonData
        };

        map.addSource('heatmap-source', heatmapSource);

        map.addLayer({
            id: 'heatmap-layer',
            type: 'heatmap',
            source: 'heatmap-source',
            maxzoom: 15,
            paint: {
                'heatmap-weight': [
                    'interpolate',
                    ['linear'],
                    ['get', 'weight'],
                    0, 0,
                    1, 0.3,
                    10, 0.6,
                    50, 0.9,
                    100, 1
                ],
                'heatmap-intensity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 1,
                    7, 2,
                    10, 3,
                    15, 4
                ],
                'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(0, 0, 0, 0)',
                    0.2, 'rgba(20, 184, 166, 0.4)',
                    0.4, 'rgba(20, 184, 166, 0.7)',
                    0.6, 'rgba(234, 179, 8, 0.8)',
                    0.8, 'rgba(251, 146, 60, 0.9)',
                    1, 'rgba(239, 68, 68, 1)'
                ],
                'heatmap-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 3,
                    7, 15,
                    10, 25,
                    15, 50
                ],
                'heatmap-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 0.9,
                    7, 0.95,
                    15, 1
                ]
            }
        });

        map.addLayer({
            id: 'heatmap-click-layer',
            type: 'circle',
            source: 'heatmap-source',
            paint: {
                'circle-radius': 15,
                'circle-opacity': 0,
                'circle-stroke-width': 0
            }
        });

        map.on('click', 'heatmap-click-layer', (e) => {
            const features = map.queryRenderedFeatures(e.point, {
                layers: ['heatmap-click-layer']
            });

            if (features.length > 0) {
                const feature = features[0];
                if (feature && feature.properties) {
                    showHotspotPopup(e.lngLat, feature.properties);
                }
            }
        });

        map.on('mouseenter', 'heatmap-click-layer', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'heatmap-click-layer', () => {
            map.getCanvas().style.cursor = '';
        });
    }
};

const showHotspotPopup = (lngLat, properties) => {
    const pointCount = properties.point_count || 0;
    let operators = properties.operators;

    let operatorsArray = [];
    if (typeof operators === 'string') {
        try {
            operatorsArray = JSON.parse(operators);
        } catch (e) {
            operatorsArray = [];
        }
    } else if (Array.isArray(operators)) {
        operatorsArray = operators;
    }

    const topOperators = operatorsArray
        .sort((a, b) => (b.count || b.point_count || 0) - (a.count || a.point_count || 0))
        .slice(0, 3);

    const popupContent = `
        <div class="popup-header">
            <div class="popup-title">
                <i class="fas fa-fire"></i>
                Hotspot Activity
            </div>
            <div class="popup-subtitle">${pointCount} points detected</div>
        </div>
        <div class="popup-content">
            <div class="popup-operators">
                ${topOperators.length > 0 ? topOperators.map(operator => {
                    const name = operator.name || operator.operator_name || 'Unknown';
                    const count = operator.count || operator.point_count || 0;
                    return `
                        <div class="popup-operator-item">
                            <span class="popup-operator-name">${name}</span>
                            <span class="popup-operator-count">${count}</span>
                        </div>
                    `;
                }).join('') : '<div style="padding: 1rem; text-align: center; color: #94a3b8; font-size: 0.875rem;">No operator data available</div>'}
            </div>
        </div>
    `;

    new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        className: 'custom-popup'
    })
        .setLngLat(lngLat)
        .setHTML(popupContent)
        .addTo(map);
};

const fetchTransports = async () => {
    const bbox = getBbox();
    if (!bbox) return;

    const transportsList = document.getElementById('transports-list');
    transportsList.innerHTML = `
        <div class="loading-skeleton">
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
        </div>
    `;

    try {
        const url = `${API_BASE_URL}/area/companies/transports?bbox=${bbox}`;
        const response = await fetch(url, {
            headers: {
                'X-App-Key': API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        transportsData = (data && data.transports && Array.isArray(data.transports)) ? data.transports : [];
        renderTransports();
    } catch (error) {
        console.error('Error fetching transports:', error);
        transportsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error loading transports</p>
            </div>
        `;
    }
};

const renderTransports = () => {
    const transportsList = document.getElementById('transports-list');
    const feedCount = document.getElementById('feed-count');

    feedCount.textContent = `${transportsData.length} transport${transportsData.length !== 1 ? 's' : ''}`;

    if (!transportsData || transportsData.length === 0) {
        transportsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No transports in this area</p>
            </div>
        `;
        return;
    }

    transportsList.innerHTML = transportsData.map(transport => {
        const transportId = transport.transport_id || 'N/A';
        const companyName = transport.company_name || 'Unknown';
        const role = transport.role || 'unknown';
        const roleLower = role.toLowerCase();
        const firstPosition = transport.first_position || {};
        const timestamp = firstPosition.timestamp || null;
        
        let timeDisplay = 'N/A';
        if (timestamp) {
            try {
                const date = new Date(timestamp);
                timeDisplay = date.toLocaleTimeString('ro-RO', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
            } catch (e) {
                timeDisplay = 'N/A';
            }
        }

        const roleClass = roleLower === 'emitent' ? 'emitent' : 'destinatar';
        const roleDisplay = roleLower === 'emitent' ? 'Emitent' : 'Destinatar';

        return `
            <div class="transport-card role-${roleClass}">
                <div class="transport-company">${companyName}</div>
                <div class="transport-badge ${roleClass}">${roleDisplay}</div>
                <div class="transport-meta">
                    <div class="transport-meta-row">
                        <span class="transport-meta-label">ID:</span>
                        <span class="transport-meta-value">#${transportId.slice(0, 8)}...</span>
                    </div>
                    <div class="transport-meta-row">
                        <span class="transport-meta-label">Time:</span>
                        <span class="transport-meta-value">${timeDisplay}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

const initMap = () => {
    map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [25.0, 46.0],
        zoom: 7,
        pitch: 0,
        bearing: 0
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
        fetchHeatmapData();
        fetchTransports();
    });

    map.on('moveend', () => {
        fetchHeatmapData();
        fetchTransports();
    });

    map.on('zoomend', () => {
        fetchHeatmapData();
    });
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});
