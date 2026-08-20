document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  if (typeof mapboxgl === 'undefined' || !window.KoobaiRun) {
    return;
  }

  /* ========================================================================
     板块 1：基础配置与 Mapbox 初始化
  ======================================================================== */
  
  const FLAG_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20">
      <path fill="currentColor" d="M4.5 3.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H6v2.75a.75.75 0 0 1-1.5 0zM6 13h3v-3h3v3h3v-3h-3V7h3V4h-3v3H9V4H6v3h3v3H6z"/>
    </svg>`;

  // 默认固定打卡点：罗湖大剧院坐标 [经度, 纬度]
  const DEFAULT_FIXED_POINT = [114.097, 22.5488];

  mapboxgl.accessToken = window.KoobaiRun.config.MAPBOX_TOKEN;

  const getMapStyleUrl = () => {
    const theme = document.documentElement.getAttribute('data-theme');
    const styles = {
      paper: 'mapbox://styles/mapbox/light-v11',
      night: 'mapbox://styles/mapbox/dark-v11',
      sepia: 'mapbox://styles/mapbox/light-v11',
      mist: 'mapbox://styles/mapbox/light-v11'
    };
    if (styles[theme]) return styles[theme];
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? styles.night
      : styles.paper;
  };

  const map = new mapboxgl.Map({
    container: 'mapbox-container', 
    style: getMapStyleUrl(), 
    center: [120.1551, 30.2741], 
    zoom: 11, 
    pitch: 0, 
    bearing: 0, 
    maxPitch: 85,
    logoPosition: 'bottom-right', 
    attributionControl: false,
    preserveDrawingBuffer: true
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-left');

  const MAP_PALETTES = {
    sepia: {
      land: '#eef0f2', water: '#d8e0e5', park: '#e3e7e2', building: '#e0e3e5',
      road: '#fafbfc', roadEdge: '#cbd1d6', boundary: '#abb2b8', label: '#596168', halo: '#f9fafb'
    },
    mist: {
      land: '#f8f2ef', water: '#dedee8', park: '#e8e7dc', building: '#efe0db',
      road: '#fffaf8', roadEdge: '#ddcbc5', boundary: '#c2aaa1', label: '#735f58', halo: '#fffaf8'
    }
  };

  const applyMapPalette = () => {
    const palette = MAP_PALETTES[document.documentElement.dataset.theme];
    if (!palette || !map.isStyleLoaded()) return;

    const layers = map.getStyle()?.layers || [];
    layers.forEach(layer => {
      const key = `${layer.id} ${layer['source-layer'] || ''}`.toLowerCase();
      const setPaint = (name, value) => {
        try { map.setPaintProperty(layer.id, name, value); } catch (_) { /* property not supported by this layer */ }
      };

      if (layer.type === 'background') {
        setPaint('background-color', palette.land);
      } else if (layer.type === 'fill') {
        if (key.includes('water')) setPaint('fill-color', palette.water);
        else if (/(park|landuse|landcover|vegetation|wood)/.test(key)) setPaint('fill-color', palette.park);
        else if (/(building|structure)/.test(key)) setPaint('fill-color', palette.building);
        else setPaint('fill-color', palette.land);
      } else if (layer.type === 'line') {
        if (/(road|street|motorway|path|pedestrian|bridge|tunnel)/.test(key)) {
          setPaint('line-color', /(case|casing|outline)/.test(key) ? palette.roadEdge : palette.road);
        } else if (/(boundary|admin)/.test(key)) {
          setPaint('line-color', palette.boundary);
        } else if (/(water|river|stream)/.test(key)) {
          setPaint('line-color', palette.water);
        }
      } else if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
        setPaint('text-color', palette.label);
        setPaint('text-halo-color', palette.halo);
        setPaint('text-halo-width', 1);
      }
    });
  };

  const mapWrapper = document.getElementById('map-wrapper');
  if (mapWrapper && window.ResizeObserver) {
    new ResizeObserver(() => { requestAnimationFrame(() => map.resize()); }).observe(mapWrapper);
  }

  let currentMapStyle = getMapStyleUrl();
  let currentMapTheme = document.documentElement.dataset.theme;
  const updateMapTheme = () => {
    const newStyle = getMapStyleUrl();
    const newTheme = document.documentElement.dataset.theme;
    const leavingCustomPalette = Boolean(MAP_PALETTES[currentMapTheme] && !MAP_PALETTES[newTheme]);
    if (newStyle !== currentMapStyle || (newTheme !== currentMapTheme && leavingCustomPalette)) {
      currentMapStyle = newStyle;
      // A full reload is required when returning to paper/night; Mapbox's style
      // diff can otherwise retain paint properties changed by sepia or mist.
      map.setStyle(newStyle, leavingCustomPalette ? { diff: false } : undefined);
    } else if (newTheme !== currentMapTheme) {
      applyMapPalette();
    }
    currentMapTheme = newTheme;
  };

  const themeObserver = new MutationObserver(updateMapTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateMapTheme);
  }


  /* ========================================================================
     板块 3：核心工具函数与 GIS 算法
  ======================================================================== */
  
  const TYPE_COLORS = window.KoobaiRun.SPORT_COLORS || {};
  const FALLBACK_COLOR = '#00ED5E'; 
  const getColor = (type) => TYPE_COLORS[type] || FALLBACK_COLOR;

  const colorRules = ['match', ['get', 'type']];
  for (const [type, color] of Object.entries(TYPE_COLORS)) { 
    colorRules.push(type, color); 
  }
  colorRules.push(FALLBACK_COLOR);

  const decodePolyline = (str, precision = 5) => {
    if (!str) return [];
    let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null;
    let factor = Math.pow(10, precision);
    
    while (index < str.length) {
      byte = null; shift = 0; result = 0;
      do { 
        byte = str.charCodeAt(index++) - 63; 
        result |= (byte & 0x1f) << shift; 
        shift += 5; 
      } while (byte >= 0x20);
      lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
      
      shift = result = 0;
      do { 
        byte = str.charCodeAt(index++) - 63; 
        result |= (byte & 0x1f) << shift; 
        shift += 5; 
      } while (byte >= 0x20);
      lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
      
      coordinates.push([lng / factor, lat / factor]);
    }
    return coordinates;
  };

  const filterCityBoundingBox = (allCoordinates) => {
    if (allCoordinates.length === 0) return allCoordinates;
    const grid = {};
    
    allCoordinates.forEach(coord => {
      const key = `${Math.round(coord[1] * 10) / 10},${Math.round(coord[0] * 10) / 10}`;
      grid[key] = (grid[key] || 0) + 1;
    });
    
    let maxCount = 0, maxCenterLat = 0, maxCenterLng = 0;
    for (const key in grid) {
      if (grid[key] > maxCount) {
        maxCount = grid[key];
        const parts = key.split(',');
        maxCenterLat = parseFloat(parts[0]);
        maxCenterLng = parseFloat(parts[1]);
      }
    }
    return allCoordinates.filter(c => 
      c[1] >= maxCenterLat - 0.5 && c[1] <= maxCenterLat + 0.5 && 
      c[0] >= maxCenterLng - 0.5 && c[0] <= maxCenterLng + 0.5
    );
  };

  const calculateBearing = (start, end) => {
    const PI = Math.PI;
    const lat1 = (start[1] * PI) / 180, lon1 = (start[0] * PI) / 180;
    const lat2 = (end[1] * PI) / 180, lon2 = (end[0] * PI) / 180;
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / PI + 360) % 360;
  };

  /* ========================================================================
     板块 4：全局状态与图层渲染核心
  ======================================================================== */
  
  let activeRunId = null;
  let animationRef = null;
  let flyToTimeout = null;
  let currentMarkers = [];
  let isFirstLoad = true;
  
  const firstYearBtn = document.querySelector('#year-nav .button');
  let currentYear = firstYearBtn ? firstYearBtn.getAttribute('data-year') : "2026";

  const resetState = () => {
    if (animationRef) cancelAnimationFrame(animationRef);
    if (flyToTimeout) clearTimeout(flyToTimeout);
    currentMarkers.forEach(m => m.remove());
    currentMarkers = [];
  };

  const injectCustomLayers = () => {
    const isDark = document.documentElement.dataset.theme === 'night';
    const mapPalette = MAP_PALETTES[document.documentElement.dataset.theme];
    
    try {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 });
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1 }); 
      }
      if (!map.getLayer('3d-buildings')) {
        map.addLayer({
          'id': '3d-buildings', 
          'source': 'composite', 
          'source-layer': 'building', 
          'filter': ['==', 'extrude', 'true'], 
          'type': 'fill-extrusion', 
          'minzoom': 14,
          'paint': { 
            'fill-extrusion-color': isDark ? '#1C1C1E' : (mapPalette?.building || '#eaeaf1'),
            'fill-extrusion-height': ['get', 'height'], 
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.6 
          }
        }); 
      }
    } catch (e) {
      console.warn("3D地形加载失败，降级为2D显示", e);
    }

    if (!map.getSource('all-runs')) {
      map.addSource('all-runs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
      map.addSource('highlight-run-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
      
      map.addLayer({ 
        id: 'runs-core', 
        type: 'line', 
        source: 'all-runs', 
        layout: { 'line-join': 'round', 'line-cap': 'round' }, 
        paint: { 'line-color': colorRules, 'line-width': 2, 'line-opacity': 0.8 } 
      });
      
      map.addLayer({ 
        id: 'run-highlight-line', 
        type: 'line', 
        source: 'highlight-run-source', 
        layout: { 'line-join': 'round', 'line-cap': 'round' }, 
        paint: { 'line-color': colorRules, 'line-width': 4, 'line-opacity': 1 } 
      });
    }
  };

  // 根据选中的年份，提取数据并重绘底图所有轨迹与单点
  const renderDataByYear = (targetYear) => {
    activeRunId = null; 
    currentYear = targetYear; 
    resetState();
    
    if (!map.getSource('all-runs')) return;
    
    const features = []; 
    let allCoordsForBounds = [];

    window.KoobaiRun.data.forEach(run => {
      if (targetYear !== 'All' && !run.start_date_local?.startsWith(targetYear)) return;
      
      // 1. 解码 Polyline 轨迹
      let coords = [];
      if (run.summary_polyline) {
        if (!run._decodedCoords) {
          run._decodedCoords = decodePolyline(run.summary_polyline);
        }
        coords = run._decodedCoords;
      }

      // 2. 核心逻辑：若没有轨迹或解码点小于等于1（如跳绳、HIIT），统一在【罗湖大剧院】标记固定点
      if (!coords || coords.length <= 1) {
        const point = (coords && coords.length === 1) ? coords[0] : DEFAULT_FIXED_POINT;
        allCoordsForBounds.push(point);

        const el = document.createElement('div');
        const color = getColor(run.type);
        el.className = 'manual-fixed-point-marker';
        el.style.cssText = `
          width: 14px;
          height: 14px;
          background-color: ${color};
          border: 2px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 0 10px ${color};
          cursor: pointer;
        `;

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          window.KoobaiRun.map.flyTo(run.run_id);
        });

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(point)
          .addTo(map);

        currentMarkers.push(marker);
        return;
      }

      // 3. 正常路线绘制（跑步、骑行等）
      allCoordsForBounds.push(...coords);
      features.push({ 
        type: 'Feature', 
        properties: { id: Number(run.run_id), type: run.type }, 
        geometry: { type: 'LineString', coordinates: coords } 
      });
    });

    map.getSource('all-runs').setData({ type: 'FeatureCollection', features });
    map.getSource('highlight-run-source').setData({ type: 'FeatureCollection', features: [] });
    map.setPaintProperty('runs-core', 'line-opacity', targetYear === 'All' ? 0.5 : 0.8);

    if (allCoordsForBounds.length > 0) {
      const validCoords = filterCityBoundingBox(allCoordsForBounds);
      const bounds = new mapboxgl.LngLatBounds();
      validCoords.forEach(c => bounds.extend(c));
      
      const cam = map.cameraForBounds(bounds, { padding: 50 });
      
      if (cam) {
        if (isFirstLoad) {
          map.jumpTo({ ...cam, zoom: cam.zoom - 0.2, pitch: 0, bearing: 0 });
          setTimeout(() => { 
            map.easeTo({ ...cam, pitch: 0, bearing: 0, duration: 1000, easing: (t) => t * (2 - t) }); 
          }, 50);
          isFirstLoad = false;
        } else {
          map.easeTo({ ...cam, pitch: 0, bearing: 0, duration: 1200 });
        }
      }
    }
  };

  map.on('style.load', () => {
    applyMapPalette();
    injectCustomLayers(); 
    
    if (activeRunId && window.KoobaiRun.ui) {
      window.KoobaiRun.ui.highlightRunInUI(null);
      const statsPanel = document.getElementById('map-stats-panel');
      if (statsPanel) statsPanel.style.display = 'none';
    }
    
    renderDataByYear(currentYear); 
  });

  document.getElementById('year-nav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.button'); 
    if (btn) {
      renderDataByYear(btn.getAttribute('data-year'));
      const statsPanel = document.getElementById('map-stats-panel');
      if (statsPanel) {
        statsPanel.style.display = 'none'; 
      }
    }
  });


  /* ========================================================================
     板块 5：路线飞行动画与单点定位
  ======================================================================== */
  window.KoobaiRun.map = {
    flyTo: (rawRunId) => {
      const normalizeId = (id) => {
        if (!id || id === 'undefined' || id === 'null') return null;
        return String(Number(String(id).replace(/,/g, '')));
      };
      
      const runId = normalizeId(rawRunId);
      const statsPanel = document.getElementById('map-stats-panel'); 

      const mapWrapper = document.getElementById('map-wrapper');
      if (mapWrapper) mapWrapper.classList.remove('show-poster-mode');
      const oldMask = document.getElementById('real-poster-mask');
      if (oldMask) oldMask.remove();

      if (normalizeId(activeRunId) === runId) {
        renderDataByYear(currentYear);
        if (window.KoobaiRun.ui) window.KoobaiRun.ui.highlightRunInUI(null); 
        if (statsPanel) statsPanel.style.display = 'none'; 
        
        const shareCtrl = document.getElementById('custom-share-ctrl');
        if (shareCtrl) shareCtrl.style.display = 'none';
        
        return;
      }

      activeRunId = runId; 
      resetState();
      
      if (window.KoobaiRun.ui) window.KoobaiRun.ui.highlightRunInUI(runId); 
      if (map.getLayer('runs-core')) map.setPaintProperty('runs-core', 'line-opacity', 0);
      if (map.getSource('highlight-run-source')) {
        map.getSource('highlight-run-source').setData({ type: 'FeatureCollection', features: [] });
      }

      const runData = window.KoobaiRun.data.find(r => normalizeId(r.run_id) === runId);
      if (!runData) return;

      if (statsPanel) {
        const distanceNum = runData.distance > 0 ? runData.distance.toFixed(2) : '--';
        const distanceUnit = runData.distance > 0 ? 'km' : ''; 
        const runTime = runData.moving_time || '--';
        const heartRate = runData.average_heartrate || '--';
        const paceNum = runData.distance > 0 ? (runData.pace_num || '--') : '--';
        const paceUnit = runData.distance > 0 ? (runData.pace_unit || '') : '';
        const color = getColor(runData.type);
        const isRide = ['Ride', 'VirtualRide', 'EBikeRide'].includes(runData.type);
        const displayTime = runData.start_date_local.substring(5, 16).replace('T', ' ');
        const smartName = window.KoobaiRun.getSmartName(runData.name, runData.type, runData.summary_polyline);

        statsPanel.innerHTML = `
          <div class="normal-view">
            <div class="detailName">
              <span class="detailDate">${displayTime}</span>
            </div>
            <div class="detailStatsRow">
              <div class="detailStatBlock"><span class="statLabel">里程</span><span class="statVal" style="color: ${color}">${distanceNum}<small>${distanceUnit}</small></span></div>
              <div class="detailStatBlock"><span class="statLabel">用时</span><span class="statVal">${runTime}</span></div>
              <div class="detailStatBlock"><span class="statLabel">${isRide ? '均速' : '配速'}</span><span class="statVal">${paceNum}<small>${paceUnit}</small></span></div>
              <div class="detailStatBlock"><span class="statLabel">心率</span><span class="statVal">${heartRate}</span></div>
            </div>
          </div>

          <div class="poster-view" style="display: none;">
            <div class="poster-actions">
            <button id="poster-download-btn" title="保存海报"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512"><path fill="currentColor" d="M426.666 426.667H85.333V384h341.333zm-149.333-179.5l91.583-91.583l30.167 30.166L256 328.834L112.916 185.75l30.167-30.166l91.583 91.582v-204.5h42.667z"/></svg></button>
              <button id="poster-close-btn" title="退出预览"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            
            <div class="poster-dist-hero">
              <span class="heroNum">${distanceNum}</span>
              <span class="heroUnit">${distanceUnit}</span>
            </div>
            
            <div class="poster-stats-row">
              <div class="poster-stat-block"><span class="statLabel">用时</span><span class="statVal">${runTime}</span></div>
              <div class="poster-stat-block"><span class="statLabel">${isRide ? '均速' : '配速'}</span><span class="statVal">${paceNum}<small>${paceUnit}</small></span></div>
              <div class="poster-stat-block"><span class="statLabel">心率</span><span class="statVal">${heartRate}</span></div>
            </div>
            
            <div class="poster-watermark">${displayTime}</div>
            <div class="poster-title">${smartName}</div>
          </div>
        `;
        statsPanel.style.display = 'flex';

        const wrapper = document.getElementById('map-wrapper');
        const normalView = statsPanel.querySelector('.normal-view');
        const posterView = statsPanel.querySelector('.poster-view');
        
        let shareCtrl = document.getElementById('custom-share-ctrl');
        if (!shareCtrl) {
          const target = document.querySelector('.mapboxgl-ctrl-bottom-left');
          if (target) {
            shareCtrl = document.createElement('div');
            shareCtrl.id = 'custom-share-ctrl';
            shareCtrl.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
            shareCtrl.innerHTML = `
              <button type="button" title="生成海报" class="map-share">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m12 2.586l6.207 6.207l-1.414 1.414L13 6.414V16h-2V6.414l-3.793 3.793l-1.414-1.414zM3 18v-4h2v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4h2v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3"/></svg>
              </button>`;
            target.prepend(shareCtrl); 
          }
        }

        if (shareCtrl) {
          shareCtrl.style.display = 'block';
          shareCtrl.onclick = (e) => {
            e.stopPropagation();
            wrapper.classList.add('show-poster-mode');
            normalView.style.display = 'none';
            posterView.style.display = 'block';

            if (!document.getElementById('real-poster-mask')) {
              const mask = document.createElement('div');
              mask.id = 'real-poster-mask';
              mask.className = 'poster-gradient-mask'; 
              wrapper.appendChild(mask);
            }
          };
        }

        document.getElementById('poster-close-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          wrapper.classList.remove('show-poster-mode');
          posterView.style.display = 'none';
          normalView.style.display = 'block';
          const mask = document.getElementById('real-poster-mask');
          if (mask) mask.remove();
        });

        document.getElementById('poster-download-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          btn.style.opacity = '0.5'; 

          htmlToImage.toCanvas(wrapper, {
            pixelRatio: 4, 
            backgroundColor: null, 
            filter: (node) => !node.classList?.contains('poster-actions')
          }).then(function (canvas) {
            const webpDataUrl = canvas.toDataURL('image/webp', 0.92);
            const link = document.createElement('a');
            link.download = `KoobaiRun_${displayTime.replace(/[\/\s:]/g, '')}.webp`;
            link.href = webpDataUrl;
            link.click();
            btn.style.opacity = '1';
          }).catch(function (error) {
            console.error('海报生成失败:', error);
            btn.style.opacity = '1';
          });
        });
      }

      let coords = runData._decodedCoords;
      if (!coords && runData.summary_polyline) {
        coords = decodePolyline(runData.summary_polyline);
      }

      const sportColor = getColor(runData.type);

      // 单点点击定位：平移到固定点（大剧院）并弹出发光高亮圆点
      if (!coords || coords.length <= 1) {
        const point = (coords && coords.length === 1) ? coords[0] : DEFAULT_FIXED_POINT;

        const el = document.createElement('div');
        el.className = 'selected-point-marker';
        el.style.cssText = `
          width: 18px;
          height: 18px;
          background-color: ${sportColor};
          border: 3px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 0 15px ${sportColor};
        `;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(point)
          .addTo(map);

        currentMarkers.push(marker);

        map.flyTo({
          center: point,
          zoom: 15,
          pitch: 0,
          duration: 1000,
          essential: true
        });
        return;
      }

      // 正常轨迹动效逻辑
      const totalPoints = coords.length;
      const startEl = document.createElement('div'); 
      startEl.style.color = sportColor; 
      startEl.style.lineHeight = '0'; 
      startEl.innerHTML = FLAG_SVG;
      
      const endEl = document.createElement('div'); 
      endEl.style.color = sportColor; 
      endEl.style.lineHeight = '0'; 
      endEl.innerHTML = FLAG_SVG;

      currentMarkers.push(
        new mapboxgl.Marker({ element: startEl, anchor: 'bottom-left', offset: [-5, 4] })
          .setLngLat(coords[0])
          .addTo(map),
        new mapboxgl.Marker({ element: endEl, anchor: 'bottom-left', offset: [-5, 4] })
          .setLngLat(coords[coords.length - 1])
          .addTo(map)
      );

      const cumulativeDistances = new Float32Array(totalPoints); 
      cumulativeDistances[0] = 0;
      for (let i = 1; i < totalPoints; i++) {
        cumulativeDistances[i] = cumulativeDistances[i - 1] + Math.sqrt(
          Math.pow(coords[i][0] - coords[i - 1][0], 2) + Math.pow(coords[i][1] - coords[i - 1][1], 2)
        );
      }
      const totalGeoDistance = cumulativeDistances[totalPoints - 1];

      let startTime = null;
      let currentBearing = calculateBearing(coords[0], coords[Math.min(5, totalPoints - 1)]);
      map.flyTo({ center: coords[0], bearing: currentBearing, pitch: 70, zoom: 16, duration: 2500, essential: true });

      const animate = (timestamp) => {
        if (normalizeId(activeRunId) !== runId) return; 
        if (!startTime) startTime = timestamp;
        
        const progress = Math.min((timestamp - startTime) / Math.min(3500 + Math.sqrt(runData.distance || 5) * 800, 12000), 1);
        const targetDist = progress * totalGeoDistance;

        let l = 0, r = totalPoints - 1, idx = 0;
        while (l <= r) { 
          const mid = (l + r) >> 1; 
          if (cumulativeDistances[mid] <= targetDist) { 
            idx = mid; 
            l = mid + 1; 
          } else {
            r = mid - 1; 
          }
        }
        if (idx >= totalPoints - 1) idx = totalPoints - 2;

        const remainder = (cumulativeDistances[idx + 1] - cumulativeDistances[idx]) > 0 
          ? (targetDist - cumulativeDistances[idx]) / (cumulativeDistances[idx + 1] - cumulativeDistances[idx]) 
          : 0;

        if (progress < 1) {
          if (coords[idx] && coords[idx + 1]) {
            const currentPos = [ 
              coords[idx][0] + (coords[idx + 1][0] - coords[idx][0]) * remainder, 
              coords[idx][1] + (coords[idx + 1][1] - coords[idx][1]) * remainder 
            ];
            
            const currentLineCoords = coords.slice(0, idx + 1); 
            currentLineCoords.push(currentPos);
            
            if (map.getSource('highlight-run-source')) {
              map.getSource('highlight-run-source').setData({ 
                type: 'FeatureCollection', 
                features: [{ 
                  type: 'Feature', 
                  properties: { type: runData.type }, 
                  geometry: { type: 'LineString', coordinates: currentLineCoords } 
                }] 
              });
            }

            let lookAheadIdx = idx; 
            while (lookAheadIdx < totalPoints - 1 && cumulativeDistances[lookAheadIdx] < targetDist + totalGeoDistance * 0.05) {
              lookAheadIdx++;
            }
            currentBearing += ((((calculateBearing(currentPos, coords[lookAheadIdx]) - currentBearing) + 540) % 360) - 180) * 0.05; 
            
            map.easeTo({ center: currentPos, bearing: currentBearing, pitch: 70, zoom: 16.5, duration: 32, easing: (t) => t });
          }
          animationRef = requestAnimationFrame(animate);

        } else {
          if (map.getSource('highlight-run-source')) {
            map.getSource('highlight-run-source').setData({ 
              type: 'FeatureCollection', 
              features: [{ 
                type: 'Feature', 
                properties: { type: runData.type }, 
                geometry: { type: 'LineString', coordinates: coords } 
              }] 
            });
          }
          
          flyToTimeout = setTimeout(() => {
            const endCam = map.cameraForBounds([
              [Math.min(...coords.map(p => p[0])), Math.min(...coords.map(p => p[1]))], 
              [Math.max(...coords.map(p => p[0])), Math.max(...coords.map(p => p[1]))]
            ], { padding: 60 });
            
            if (endCam) {
              map.easeTo({ ...endCam, pitch: 0, bearing: 0, duration: 1500 });
            }
          }, 1000); 
        }
      };
      
      flyToTimeout = setTimeout(() => { 
        animationRef = requestAnimationFrame(animate); 
      }, 2600);
      
    }
  };
});
