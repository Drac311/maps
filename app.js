// 1. Inicializar mapa y geolocalización
const map = L.map('map').setView([40.4168, -3.7038], 13); // Madrid por defecto
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let userLatLng = null;
let routeLayer = null;

// Obtener ubicación del usuario
navigator.geolocation.getCurrentPosition((pos) => {
    userLatLng = [pos.coords.latitude, pos.coords.longitude];
    map.setView(userLatLng, 14);
    L.marker(userLatLng).addTo(map).bindPopup("Estás aquí").openPopup();
}, (err) => {
    showError("No se pudo obtener tu ubicación. Activa el GPS.");
});

// 2. Lógica de búsqueda (usando Nominatim para geocodificar)
async function searchDestination() {
    const query = document.getElementById('destination').value;
    if (!query || !userLatLng) return;

    showLoading(true);
    hideError();

    try {
        // Geocodificación gratuita con Nominatim
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const geoData = await geoRes.json();
        
        if (!geoData.length) throw new Error("Dirección no encontrada");
        
        const destLatLng = [parseFloat(geoData[0].lat), parseFloat(geoData[0].lon)];
        
        // Obtener rutas con OSRM (alternativas)
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${userLatLng[1]},${userLatLng[0]};${destLatLng[1]},${destLatLng[0]}?overview=full&geometries=geojson&alternatives=true`;
        const routeRes = await fetch(osrmUrl);
        const routeData = await routeRes.json();

        if (!routeData.routes || routeData.routes.length === 0) {
            throw new Error("No se encontraron rutas");
        }

        // 3. Calcular puntuación de curvas para cada ruta
        const scoredRoutes = routeData.routes.map(route => {
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lng]
            const score = calculateCurvatureScore(coords);
            return { ...route, coords, score };
        }).sort((a, b) => b.score - a.score);

        const best = scoredRoutes[0];
        displayRoute(best, scoredRoutes.length);
        
    } catch (err) {
        showError(err.message);
    } finally {
        showLoading(false);
    }
}

// 4. Función de puntuación de curvas (portada de Swift)
function calculateCurvatureScore(coords) {
    if (coords.length < 3) return 0;
    let totalAngleChange = 0;
    
    for (let i = 1; i < coords.length - 1; i++) {
        const bearing1 = calculateBearing(coords[i-1], coords[i]);
        const bearing2 = calculateBearing(coords[i], coords[i+1]);
        let diff = Math.abs(bearing1 - bearing2);
        if (diff > 180) diff = 360 - diff;
        totalAngleChange += diff;
    }
    
    // Longitud aproximada en km
    let lengthKm = 0;
    for (let i = 1; i < coords.length; i++) {
        lengthKm += haversine(coords[i-1], coords[i]);
    }
    
    return lengthKm > 0 ? totalAngleChange / lengthKm : totalAngleChange;
}

function calculateBearing(p1, p2) {
    const lat1 = p1[0] * Math.PI / 180;
    const lon1 = p1[1] * Math.PI / 180;
    const lat2 = p2[0] * Math.PI / 180;
    const lon2 = p2[1] * Math.PI / 180;
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function haversine(p1, p2) {
    const R = 6371;
    const dLat = (p2[0] - p1[0]) * Math.PI / 180;
    const dLon = (p2[1] - p1[1]) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1[0]*Math.PI/180) * Math.cos(p2[0]*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// 5. Actualizar UI (similar a tus vistas SwiftUI)
function displayRoute(route, totalRoutes) {
    if (routeLayer) map.removeLayer(routeLayer);
    
    routeLayer = L.polyline(route.coords, { color: '#f97316', weight: 6, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

    const score = Math.round(route.score);
    const rating = getFunRating(score);
    const emoji = getFunEmoji(score);
    const mins = Math.round(route.duration / 60);
    const timeStr = mins < 60 ? `${mins} min` : `${Math.floor(mins/60)} h ${mins%60} min`;

    document.getElementById('fun-emoji').textContent = emoji;
    document.getElementById('fun-rating').textContent = rating;
    document.getElementById('points').textContent = `${score} pts`;
    document.getElementById('distance').textContent = `${(route.distance / 1000).toFixed(1)} km`;
    document.getElementById('time').textContent = timeStr;
    document.getElementById('route-count').textContent = `${totalRoutes} rutas`;
    document.getElementById('route-card').classList.remove('hidden');
}

function getFunRating(score) {
    if (score < 50) return "Recta aburrida 😴";
    if (score < 150) return "Algo de curvas 🙂";
    if (score < 300) return "Bastante divertida 😄";
    if (score < 500) return "¡Muy divertida! 🏍️";
    return "¡EXTREMA! 🔥🏁";
}

function getFunEmoji(score) {
    if (score < 50) return "😴";
    if (score < 150) return "🙂";
    if (score < 300) return "😄";
    if (score < 500) return "🏍️";
    return "🔥";
}

// Helpers UI
function showLoading(show) { document.getElementById('loading').classList.toggle('hidden', !show); }
function showError(msg) { const el = document.getElementById('error'); el.textContent = msg; el.classList.remove('hidden'); }
function hideError() { document.getElementById('error').classList.add('hidden'); }

document.getElementById('search-btn').addEventListener('click', searchDestination);
document.getElementById('destination').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchDestination(); });