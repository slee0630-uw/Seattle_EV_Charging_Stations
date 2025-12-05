// Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiaGlldXRyYW4yIiwiYSI6ImNtaGVkdnNvNTBkNG0ybXExNjFobWFpMm8ifQ.csZ4K-7ctmQ5pw29u2U5Pw';

// GeoJSON file
const stores = './assets/station.geojson';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-122.335167, 47.608013], // Seattle Center
  zoom: 10,
  scrollZoom: true
});

let storesDataGlobal = null;
let userLocation = null;
let currentTypeFilter = 'all';

map.on('load', async () => {
    const response = await fetch(stores);
    const data = await response.json();

    // Add unique IDs
    data.features.forEach((feature, i) => {
        feature.properties.id = i;
    });

    storesDataGlobal = data;

    map.addSource('places', {
        type: 'geojson',
        data: storesDataGlobal
    });
    
    //  Build sidebar + markers
    buildLocationList(storesDataGlobal);
    addMarkers(storesDataGlobal);

    setupFilterControls();
    setupTypeButtons();
    setupZoomButtons();
    setupFilterToggle();
});

map.on('click', () => {
    const popUps = document.getElementsByClassName('mapboxgl-popup');
    if (popUps[0]) popUps[0].remove();

    const activeItem = document.getElementsByClassName('active');
    if (activeItem[0]) activeItem[0].classList.remove('active');
});

// Decide what "type" of charger this station is
function getStationType(props) {
  const l1 = Number(props.EV_Level1_EVSE_Ports) || 0;
  const l2 = Number(props.EV_Level2_EVSE_Ports) || 0;
  const dc = Number(props.EV_DC_Fast_Ports) || 0;

  if (dc > 0) return 'dcfast';      // any DC ports → DC fast
  if (l2 > 0) return 'level2';      // otherwise any Level 2
  if (l1 > 0) return 'level1';      // otherwise Level 1
  return 'other';
}

// Determine charging type for each station
function getIconForType(stationType) {
    if (stationType === 'level1') return './favicon/type1.png';
    if (stationType === 'level2') return './favicon/type2.png';
    if (stationType === 'dcfast') return './favicon/dc.png';
    return './favicon/marker.png'; // fallback
  }
  

/* Add custom markers to the map */
function addMarkers(storesData) {
  for (const marker of storesData.features) {
    const el = document.createElement('div');
    el.id = `marker-${marker.properties.id}`;

    const stationType = getStationType(marker.properties);
    const iconPath = getIconForType(stationType);
    
    el.className = 'marker';
    el.style.backgroundImage = `url('${iconPath}')`;
    
    new mapboxgl.Marker(el, { offset: [0, -23] })
      .setLngLat(marker.geometry.coordinates)
      .addTo(map);

    el.addEventListener('click', (e) => {
      flyToStore(marker);
      createPopUp(marker);

      const activeItem = document.getElementsByClassName('active');
      e.stopPropagation();

      if (activeItem[0]) {
        activeItem[0].classList.remove('active');
      }
      const listing = document.getElementById(`listing-${marker.properties.id}`);
      listing.classList.add('active');
    });
  }
}

/* Build sidebar list of EV charging stations */
function buildLocationList(storesData) {
    for (const store of storesData.features) {
        const listings = document.getElementById('listings');
        const listing = listings.appendChild(document.createElement('div'));
        listing.id = `listing-${store.properties.id}`;
        listing.className = 'item';

        const link = listing.appendChild(document.createElement('a'));
        link.href = '#';
        link.className = 'title';
        link.innerHTML = store.properties.Station_Name || 'No name';

        const details = listing.appendChild(document.createElement('div'));
        details.innerHTML = store.properties.City || '';

        const tooltip = listing.appendChild(document.createElement('div'));
        tooltip.className = 'tooltip';

        const address = store.properties.Address || 'No address';
        const phone = store.properties.Phone_Number || 'No number';

        tooltip.innerHTML = `
        <strong>${address}</strong><br>
        ${phone}
        `;

        link.addEventListener('click', function () {
        flyToStore(store);
        createPopUp(store);

        const activeItem = document.getElementsByClassName('active');
        if (activeItem[0]) {
            activeItem[0].classList.remove('active');
        }
        this.parentNode.classList.add('active');
        });
    }
}

function flyToStore(currentFeature) {
    map.flyTo({
        center: currentFeature.geometry.coordinates,
        zoom: 15
    });
}

function createPopUp(currentFeature) {
    const popUps = document.getElementsByClassName('mapboxgl-popup');
    if (popUps[0]) popUps[0].remove();

    const props = currentFeature.properties;

    const name = props.Station_Name || 'Unknown Station';
    const address = props.Address || 'No address available';
    const phone = props.Phone_Number || '';
    const pricing = props.EV_Pricing || 'N/A';
    const type = props.EV_Connector_Types || 'N/A';

    new mapboxgl.Popup({ closeOnClick: false })
    .setLngLat(currentFeature.geometry.coordinates)
    .setHTML(`
        <h3>${name}</h3>
        <h4 style="margin:0; padding:2px 6px;">
            ${address}<br>
            ${phone}<br>
            Type: ${type}<br>
            Price: ${pricing}
        </h4>
    `)
    .addTo(map);
}

/* FILTER SYSTEM */

function setupFilterControls() {
    const availabilitySelect = document.getElementById('availabilityFilter');
    const priceSelect = document.getElementById('priceFilter');
    const distanceSelect = document.getElementById('distanceFilter');
    const useLocationBtn = document.getElementById('useLocationBtn');

    // Dropdown filters
    availabilitySelect.addEventListener('change', applyFilters);
    priceSelect.addEventListener('change', applyFilters);
    distanceSelect.addEventListener('change', applyFilters);

    // Use My Location → triggers distance calculation
    useLocationBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
        alert('Geolocation is not supported in this browser.');
        return;
        }
        navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = [pos.coords.longitude, pos.coords.latitude];
            updateDistancesFromUser();
            applyFilters();
            alert('Distance from your location has been calculated.');
        },
        (err) => {
            console.error(err);
            alert('Could not access your location. Please allow location permission.');
        }
        );
    });
}

function updateDistancesFromUser() {
    if (!storesDataGlobal || !userLocation) return;

    const userPoint = turf.point(userLocation);

    storesDataGlobal.features.forEach(f => {
        const coords = f.geometry && f.geometry.coordinates;
        if (!coords) return;

        const stationPoint = turf.point(coords);
        const dist = turf.distance(userPoint, stationPoint, { units: 'miles' });

        // Save new distance property in GeoJSON
        f.properties.distance_miles = dist;
    });
}

function applyFilters() {
    if (!storesDataGlobal) return;

    const availability = document.getElementById('availabilityFilter').value;
    const price = document.getElementById('priceFilter').value;
    const maxDist = Number(document.getElementById('distanceFilter').value);

    storesDataGlobal.features.forEach(f => {
        const id = f.properties.id;
        const markerEl = document.getElementById(`marker-${id}`);
        const listingEl = document.getElementById(`listing-${id}`);

        let visible = true;

        // Filter by availability (Current_Status = E / P / T)
        const status = f.properties.Current_Status;
        if (availability === 'available') {
            visible = visible && (status === 'E'); // E = Available
        } else if (availability === 'unavailable') {
            visible = visible && (status && status !== 'E');
        }

        // Filter by price
        const pricingRaw = f.properties.EV_Pricing || '';
        const pricing = pricingRaw.toLowerCase();

        if (price === 'free') {
            visible = visible && pricing.includes('free');
        } else if (price === 'paid') {
            visible = visible && (pricingRaw !== '' && !pricing.includes('free'));
        }

        // Filter by distance from user
        if (maxDist > 0) {
            const d = f.properties.distance_miles;
        if (typeof d !== 'number') {
            visible = false;
        } else {
            visible = visible && d <= maxDist;
        }
        }

        // Filter by charging type (Level1/Level2/DC Fast)
        const stationType = getStationType(f.properties);
        if (currentTypeFilter !== 'all') {
            visible = visible && (stationType === currentTypeFilter);
        }

        // Apply visibility to markers + sidebar list
        markerEl.style.display = visible ? '' : 'none';
        listingEl.style.display = visible ? '' : 'none';
    });
}

/* CUSTOM ZOOM BUTTONS */

function setupZoomButtons() {
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

  if (zoomInBtn && zoomOutBtn) {
    zoomInBtn.addEventListener('click', () => map.zoomIn());
    zoomOutBtn.addEventListener('click', () => map.zoomOut());
  }
}

/* FILTER PANEL TOGGLE BUTTON */
function setupFilterToggle() {
  const filterToggleBtn = document.getElementById('filterToggleBtn');
  const filtersPanel = document.getElementById('filters');

  if (filterToggleBtn && filtersPanel) {
    filterToggleBtn.addEventListener('click', () => {
      filtersPanel.classList.toggle('collapsed');
    });
  }
}

function setupTypeButtons() {
  const container = document.getElementById('typeButtons');
  if (!container) return;

  const buttons = container.querySelectorAll('button');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentTypeFilter = btn.dataset.type; // 'all', 'level1', 'level2', 'dcfast'

      // visual state
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      applyFilters(); // re-run filters whenever type changes
    });
  });
}