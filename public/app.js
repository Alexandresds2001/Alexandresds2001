const authPanel = document.getElementById('auth-panel');
const mapPanel = document.getElementById('map-panel');
const authForm = document.getElementById('auth-form');
const registerBtn = document.getElementById('register-btn');
const authMessage = document.getElementById('auth-message');
const currentUser = document.getElementById('current-user');
const logoutBtn = document.getElementById('logout-btn');
const markerTypeSelect = document.getElementById('marker-type');
const markerLabelInput = document.getElementById('marker-label');
const markerList = document.getElementById('marker-list');

let map;
let socket;
const leafletMarkers = new Map();

const typeStyles = {
  radio: { color: '#22c55e' },
  gprs: { color: '#3b82f6' }
};

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisição');
  }

  return data;
}

function setAuthMessage(message) {
  authMessage.textContent = message;
}

function appendMarkerToList(marker) {
  const item = document.createElement('li');
  item.id = `item-${marker.id}`;
  const typeLabel = marker.type.toUpperCase();
  item.textContent = `[${typeLabel}] ${marker.label || 'Sem rótulo'} — ${marker.author}`;
  markerList.prepend(item);
}

function drawMarker(marker) {
  if (!map || leafletMarkers.has(marker.id)) {
    return;
  }

  const style = typeStyles[marker.type] || { color: '#f8fafc' };
  const leafletMarker = L.circleMarker([marker.lat, marker.lng], {
    radius: 8,
    color: style.color,
    fillOpacity: 0.85
  }).addTo(map);

  leafletMarker.bindPopup(
    `<strong>${marker.type.toUpperCase()}</strong><br>${marker.label || 'Sem rótulo'}<br>por ${marker.author}`
  );

  leafletMarkers.set(marker.id, leafletMarker);
  appendMarkerToList(marker);
}

function initMap() {
  if (map) {
    return;
  }

  map = L.map('map').setView([-14.235, -51.9253], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  map.on('click', (event) => {
    if (!socket) {
      return;
    }

    socket.emit('marker:add', {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
      type: markerTypeSelect.value,
      label: markerLabelInput.value
    });

    markerLabelInput.value = '';
  });
}

function connectSocket() {
  socket = io({
    withCredentials: true
  });

  socket.on('markers:init', (markers) => {
    markerList.innerHTML = '';
    leafletMarkers.forEach((marker) => marker.remove());
    leafletMarkers.clear();
    markers.forEach(drawMarker);
  });

  socket.on('marker:added', drawMarker);
  socket.on('marker:error', (payload) => {
    setAuthMessage(payload?.error || 'Erro ao salvar marcador.');
  });

  socket.on('connect_error', () => {
    setAuthMessage('Sua sessão expirou. Faça login novamente.');
    showAuth();
  });
}

function showMap(user) {
  authPanel.classList.add('hidden');
  mapPanel.classList.remove('hidden');
  currentUser.textContent = `Logado como: ${user.username}`;
  initMap();
  connectSocket();

  setTimeout(() => {
    map.invalidateSize();
  }, 50);
}

function showAuth() {
  mapPanel.classList.add('hidden');
  authPanel.classList.remove('hidden');

  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthMessage('');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const result = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    showMap(result.user);
  } catch (error) {
    setAuthMessage(error.message);
  }
});

registerBtn.addEventListener('click', async () => {
  setAuthMessage('');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const result = await apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    showMap(result.user);
  } catch (error) {
    setAuthMessage(error.message);
  }
});

logoutBtn.addEventListener('click', async () => {
  await apiRequest('/api/logout', { method: 'POST' });
  showAuth();
});

async function bootstrap() {
  try {
    const result = await apiRequest('/api/me');
    showMap(result.user);
  } catch {
    showAuth();
  }
}

bootstrap();
