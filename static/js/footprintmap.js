(function () {
  'use strict';

  const MAP_SELECTOR = '.footprint-map';
  const MAP_STYLES = { light: 'amap://styles/whitesmoke', dark: 'amap://styles/dark' };
  const FILTER_ALL = 'all';
  const MARKER_SIZE = 22;
  const MARKER_PRESETS = ['sunset', 'ocean', 'violet', 'forest', 'amber', 'citrus'];
  const MARKER_STYLES = {
    sunset: 'linear-gradient(135deg, #ffb347, #ff6f61)',
    ocean: 'linear-gradient(135deg, #06beb6, #48b1bf)',
    violet: 'linear-gradient(135deg, #a18cd1, #fbc2eb)',
    forest: 'linear-gradient(135deg, #5ee7df, #39a37c)',
    amber: 'linear-gradient(135deg, #f6d365, #fda085)',
    citrus: 'linear-gradient(135deg, #fdfb8f, #a1ffce)'
  };
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  let amapLoader = null;
  const registeredMaps = new Set();
  let themeObserver = null;
  let photoViewer = null;
  let suppressMapClose = false;

  const escapeHtml = str => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatDate = raw => {
    if (!raw) return '';
    const date = new Date(raw);
    return isNaN(date.getTime()) ? String(raw) : dateFormatter.format(date);
  };

  const getCurrentTheme = () => 
    document.documentElement.classList.contains('dark') ? MAP_STYLES.dark : MAP_STYLES.light;

  function init() {
    document.querySelectorAll(MAP_SELECTOR).forEach(bootstrapMap);
  }

  async function bootstrapMap(container) {
    const { json: dataUrl, amapKey: apiKey, amapSecret: apiSecret } = container.dataset;

    if (!apiKey) {
      container.innerHTML = '<div class="footprint-map__error">无法加载地图：请在模板中为容器配置 <code>data-amap-key</code>。</div>';
      return;
    }

    container.classList.add('footprint-map--loading');

    try {
      await loadAmap(apiKey, apiSecret);
      const locations = await fetchLocations(dataUrl);

      if (!locations.length) {
        container.innerHTML = '<div class="footprint-map__error">暂无足迹数据，请检查 /assets/footprints.json 文件内容。</div>';
        return;
      }

      renderMap(container, locations);
    } catch (error) {
      console.error(error);
      container.innerHTML = '<div class="footprint-map__error">足迹地图加载失败，请检查高德 Key 或网络请求。</div>';
    } finally {
      container.classList.remove('footprint-map--loading');
    }
  }

  async function loadAmap(apiKey, apiSecret) {
    if (window.AMap) return;
    if (amapLoader) return amapLoader;

    if (apiSecret) {
      window._AMapSecurityConfig = { securityJsCode: apiSecret };
    }

    amapLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${apiKey}`;
      script.async = true;
      script.onload = () => {
        // 关键：加载高德 2.0 的 DistrictLayer 图层插件
        AMap.plugin(['AMap.Scale', 'AMap.Geocoder', 'AMap.DistrictLayer'], resolve);
      };
      script.onerror = () => reject(new Error('高德地图脚本加载失败'));
      document.head.appendChild(script);
    });

    return amapLoader;
  }

  async function fetchLocations(url) {
    if (!url) return [];
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('足迹数据请求失败');
    const data = await res.json();
    
    const list = Array.isArray(data) ? data : (data.locations || data.points || []);
    return list.map(sanitizeLocation).filter(Boolean);
  }

  function sanitizeLocation(item, index) {
    const coords = parseCoords(item.coordinates || item.coordinate || item.coords || item.position);
    if (!coords) return null;

    const categories = normalizeArray(item.categories || item.category || item.tags);
    const markerStyle = getMarkerStyle(item.markerColor || item.marker || item.markerPreset, index);

    return {
      name: item.name || '未命名地点',
      province: item.province || '',
      lat: coords.lat,
      lng: coords.lng,
      url: item.url || item.link || '',
      urlLabel: item.urlLabel || item.urlTitle || item.linkTitle || '',
      description: item.description || item.desc || '',
      photos: Array.isArray(item.photos) ? item.photos : [],
      categories: categories.length ? categories : ['未分类'],
      date: formatDate(item.date || item.visited || item.visited_at || item.visitedAt),
      markerPreset: markerStyle.preset,
      markerStyle: markerStyle.style
    };
  }

  function parseCoords(value) {
    if (typeof value === 'string') {
      const parts = value.split(/[,，\s]+/).map(parseFloat).filter(n => !isNaN(n));
      if (parts.length >= 2) return { lng: parts[0], lat: parts[1] };
    }
    if (Array.isArray(value) && value.length >= 2) {
      const [lng, lat] = value.map(parseFloat);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    return null;
  }

  function normalizeArray(value) {
    if (typeof value === 'string') return [value.trim()].filter(Boolean);
    if (!Array.isArray(value)) return [];
    return value.map(v => typeof v === 'string' ? v.trim() : (v?.name || v?.label || '')).filter(Boolean);
  }

  function getMarkerStyle(raw, index) {
    if (typeof raw === 'string') {
      const value = raw.trim().toLowerCase();
      if (MARKER_STYLES[value]) {
        return { preset: value, style: `background:${MARKER_STYLES[value]}` };
      }
      if (/^(#|rgb|hsl)/.test(value)) {
        return { preset: '', style: `background:${value}` };
      }
    }
    const preset = MARKER_PRESETS[index % MARKER_PRESETS.length];
    return { preset, style: '' };
  }

  function renderMap(container, locations) {
    container.innerHTML = '';

    const mapCanvas = document.createElement('div');
    mapCanvas.className = 'footprint-map__canvas';
    container.appendChild(mapCanvas);

    const map = new AMap.Map(mapCanvas, {
      zoom: 4,
      center: [locations[0].lng, locations[0].lat],
      mapStyle: getCurrentTheme(),
      viewMode: '2D',
      rotateEnable: false,
      pitchEnable: false
    });

    map.plugin(['AMap.Scale'], () => {
      map.addControl(new AMap.Scale({ position: { bottom: '20px', right: '20px' } }));
    });

    renderCustomControls(container, map, locations);

    // ✨ 点亮省份逻辑：改用 高德 DistrictLayer 高效图层
    highlightProvincesWithLayer(map, locations);

    const infoWindow = new AMap.InfoWindow({ anchor: 'bottom-center' });

    const createMarkerClick = (point) => (e) => {
      e?.stopPropagation?.();
      suppressMapClose = true;
      infoWindow.setContent(buildInfoWindow(point));
      infoWindow.open(map, [point.lng, point.lat]);
      setTimeout(() => {
        setupPopupEvents();
        suppressMapClose = false;
      }, 0);
    };

    let allMarkers = [];
    let clusterMarkers = [];
    let markerData = locations;
    let clusterEnabled = true;

    function updateClusters() {
      [...allMarkers, ...clusterMarkers].forEach(m => m.setMap(null));
      allMarkers = [];
      clusterMarkers = [];

      const zoom = map.getZoom();
      const shouldCluster = clusterEnabled && zoom < 10;

      if (!shouldCluster) {
        markerData.forEach(point => {
          const marker = new AMap.Marker({
            position: [point.lng, point.lat],
            content: buildMarkerHtml(point),
            offset: new AMap.Pixel(-MARKER_SIZE / 2, -MARKER_SIZE / 2),
            map
          });
          marker.on('click', createMarkerClick(point));
          allMarkers.push(marker);
        });
        return;
      }

      const gridSize = 80;
      const clusters = {};

      markerData.forEach(point => {
        const pixel = map.lngLatToContainer([point.lng, point.lat]);
        const key = `${Math.floor(pixel.x / gridSize)}_${Math.floor(pixel.y / gridSize)}`;
        (clusters[key] = clusters[key] || []).push(point);
      });

      Object.values(clusters).forEach(points => {
        if (points.length === 1) {
          const point = points[0];
          const marker = new AMap.Marker({
            position: [point.lng, point.lat],
            content: buildMarkerHtml(point),
            offset: new AMap.Pixel(-MARKER_SIZE / 2, -MARKER_SIZE / 2),
            map
          });
          marker.on('click', createMarkerClick(point));
          allMarkers.push(marker);
        } else {
          const centerLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
          const centerLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
          const count = points.length;
          
          const [size, gradient, fontSize] = count < 5 
            ? [38, 'linear-gradient(135deg, rgba(6,190,182,0.75), rgba(72,177,191,0.75))', '13px']
            : count < 10
            ? [42, 'linear-gradient(135deg, rgba(94,231,223,0.75), rgba(6,190,182,0.75))', '14px']
            : [46, 'linear-gradient(135deg, rgba(255,179,71,0.75), rgba(255,111,97,0.75))', '15px'];

          const marker = new AMap.Marker({
            position: [centerLng, centerLat],
            content: `<div style="width:${size}px;height:${size}px;background:${gradient};border-radius:50%;border:1px solid rgba(255,255,255,0.4);box-shadow:0 4px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:${fontSize};text-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer">${count}</div>`,
            offset: new AMap.Pixel(-size / 2, -size / 2),
            map
          });
          marker.on('click', () => map.setZoomAndCenter(zoom + 2, [centerLng, centerLat]));
          clusterMarkers.push(marker);
        }
      });
    }

    updateClusters();
    map.on('zoomend', updateClusters);
    map.on('click', () => {
      if (suppressMapClose) return suppressMapClose = false;
      infoWindow.close();
    });

    const categories = [...new Set(locations.flatMap(l => l.categories))].filter(Boolean).sort();
    if (categories.length > 1) {
      renderFilters(container, categories, (cat) => {
        infoWindow.close();
        markerData = cat === FILTER_ALL ? locations : locations.filter(l => l.categories.includes(cat));
        updateClusters();
        map.setFitView(null, false, [60, 80, 60, 80]);
      });
    } else {
      map.setFitView(null, false, [60, 80, 60, 80]);
    }

    renderClusterToggle(container, (enabled) => {
      clusterEnabled = enabled;
      updateClusters();
    });

    registerThemeSync(map);
  }

  // 🚀 使用高德 2.0 官方原生 DistrictLayer.Province 渲染高亮省份
  function highlightProvincesWithLayer(map, locations) {
    const geocoder = new AMap.Geocoder();
    const adcodesToHighlight = new Set();

    const fetchPromises = locations.map(loc => {
      return new Promise((resolve) => {
        geocoder.getAddress([loc.lng, loc.lat], (status, result) => {
          if (status === 'complete' && result.regeocode) {
            const adcode = result.regeocode.addressComponent.adcode;
            if (adcode) {
              // 截取前两位获取省级的标准 Adcode（例如 360000 对应江西省）
              const provAdcode = adcode.substring(0, 2) + '0000';
              adcodesToHighlight.add(parseInt(provAdcode, 10));
            }
          }
          resolve();
        });
      });
    });

    Promise.all(fetchPromises).then(() => {
      const adcodeArray = Array.from(adcodesToHighlight);

      // 创建高德省份省界图层
      const disProvince = new AMap.DistrictLayer.Province({
        zIndex: 12,
        adcode: adcodeArray,
        depth: 0,
        styles: {
          'fill': 'rgba(6, 190, 182, 0.12)',         // 填充色：降低不透明度，呈现淡淡的柔和青绿
          'province-stroke': 'rgba(6, 190, 182, 0.6)',// 省界线：半透明青绿线条
          'stroke-width': 1,
          'fill-opacity': 0.18   // 点亮透明度
        }
      });

      disProvince.setMap(map);
    });
  }

  function renderCustomControls(container, map, locations) {
    const initialCenter = [locations[0].lng, locations[0].lat];
    const initialZoom = 4;

    const controlBox = document.createElement('div');
    controlBox.className = 'footprint-map__custom-controls';
    controlBox.style.cssText = `
      position: absolute;
      top: 15px;
      right: 15px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
      overflow: hidden;
    `;

    const buttons = [
      {
        title: '全屏切换',
        icon: '&#x26F6;',
        action: () => {
          if (!document.fullscreenElement) {
            container.requestFullscreen?.() || container.webkitRequestFullscreen?.();
          } else {
            document.exitFullscreen?.() || document.webkitExitFullscreen?.();
          }
        }
      },
      {
        title: '重置视角',
        icon: '&#x21BB;',
        action: () => {
          map.setZoomAndCenter(initialZoom, initialCenter);
          map.setFitView(null, false, [60, 80, 60, 80]);
        }
      },
      {
        title: '放大',
        icon: '&#x2B;',
        action: () => map.zoomIn()
      },
      {
        title: '缩小',
        icon: '&#x2212;',
        action: () => map.zoomOut()
      }
    ];

    buttons.forEach((btn, index) => {
      const btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.title = btn.title;
      btnEl.innerHTML = btn.icon;
      btnEl.style.cssText = `
        width: 32px;
        height: 32px;
        border: none;
        background: #ffffff;
        color: #333333;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        ${index < buttons.length - 1 ? 'border-bottom: 1px solid #eeeeee;' : ''}
      `;

      btnEl.onmouseover = () => btnEl.style.background = '#f5f5f5';
      btnEl.onmouseout = () => btnEl.style.background = '#ffffff';
      btnEl.onclick = (e) => {
        e.stopPropagation();
        btn.action();
      };

      controlBox.appendChild(btnEl);
    });

    container.appendChild(controlBox);
  }

  function buildMarkerHtml(point) {
    const classes = ['footprint-marker'];
    if (point.markerPreset) classes.push(`footprint-marker--${point.markerPreset}`);
    const style = point.markerStyle ? ` style="${point.markerStyle}"` : '';
    return `<span class="${classes.join(' ')}" title="${escapeHtml(point.name)}"${style}></span>`;
  }

  function buildInfoWindow(point) {
    const parts = [`<div class="footprint-popup"><h4>${escapeHtml(point.name)}</h4>`];
    
    if (point.date) parts.push(`<p class="footprint-popup__meta">${escapeHtml(point.date)}</p>`);
    
    if (point.categories.length) {
      parts.push(`<div class="footprint-popup__tags">${
        point.categories.map(c => `<span class="footprint-popup__tag">${escapeHtml(c)}</span>`).join('')
      }</div>`);
    }
    
    if (point.description) parts.push(`<p>${escapeHtml(point.description)}</p>`);
    
    if (point.url) {
      const label = point.urlLabel || '查看相关内容';
      parts.push(`<div class="footprint-popup__links"><a class="footprint-popup__link" href="${escapeHtml(point.url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></div>`);
    }
    
    if (point.photos.length) {
      const needsNav = point.photos.length > 1;
      const nav = needsNav ? 
        '<button type="button" class="footprint-popup__photos-btn footprint-popup__photos-btn--prev">&#10094;</button>' +
        '<button type="button" class="footprint-popup__photos-btn footprint-popup__photos-btn--next">&#10095;</button>' : '';
      const slides = point.photos.map((src, i) => 
        `<figure class="footprint-popup__slide"><img src="${escapeHtml(src)}" loading="lazy" alt="${escapeHtml(point.name)}-${i + 1}"></figure>`
      ).join('');
      parts.push(`<div class="footprint-popup__photos"${needsNav ? ' data-carousel="true"' : ''}>${nav}<div class="footprint-popup__track">${slides}</div></div>`);
    }
    
    parts.push('</div>');
    return parts.join('');
  }

  function setupPopupEvents() {
    requestAnimationFrame(() => {
      const popup = document.querySelector('.footprint-popup');
      if (!popup) return;

      const carousel = popup.querySelector('.footprint-popup__photos[data-carousel]');
      if (carousel) {
        const track = carousel.querySelector('.footprint-popup__track');
        carousel.querySelectorAll('.footprint-popup__photos-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const dir = btn.classList.contains('footprint-popup__photos-btn--next') ? 1 : -1;
            track.scrollBy({ left: track.clientWidth * 0.85 * dir, behavior: 'smooth' });
          });
        });
      }

      popup.querySelectorAll('.footprint-popup__photos img').forEach(img => {
        if (img.dataset.bound) return;
        img.dataset.bound = '1';
        img.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          openPhotoViewer(img.src, img.alt);
        });
      });
    });
  }

  function renderFilters(container, categories, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'footprint-map__filters';

    const createBtn = (label, value, active) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'footprint-map__filter-btn';
      btn.textContent = label;
      btn.dataset.filter = value;
      if (active) btn.classList.add('is-active');
      btn.onclick = () => {
        if (btn.classList.contains('is-active')) return;
        wrapper.querySelectorAll('.footprint-map__filter-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        onChange(value);
      };
      return btn;
    };

    wrapper.appendChild(createBtn('全部足迹', FILTER_ALL, true));
    categories.forEach(cat => wrapper.appendChild(createBtn(cat, cat, false)));
    container.appendChild(wrapper);
  }

  function renderClusterToggle(container, onChange) {
    let enabled = true;
    const isDark = () => document.documentElement.classList.contains('dark');

    const wrapper = document.createElement('div');
    wrapper.className = 'footprint-map__cluster-toggle';
    wrapper.style.cssText = `position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-size:13px;user-select:none;transition:all 0.3s`;

    const label = document.createElement('span');
    label.textContent = '集群显示';
    label.style.cssText = 'font-weight:500;transition:color 0.3s';

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.style.cssText = 'position:relative;width:44px;height:24px;border:none;border-radius:12px;cursor:pointer;transition:background 0.3s;outline:none';

    const knob = document.createElement('span');
    knob.style.cssText = 'position:absolute;top:2px;width:20px;height:20px;background:white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.2);transition:left 0.3s';

    switchBtn.appendChild(knob);

    const updateTheme = () => {
      const dark = isDark();
      wrapper.style.background = dark ? 'rgba(40,40,40,0.95)' : 'rgba(255,255,255,0.95)';
      wrapper.style.boxShadow = `0 2px 8px rgba(0,0,0,${dark ? 0.4 : 0.15})`;
      label.style.color = dark ? '#e0e0e0' : '#333';
      switchBtn.style.background = enabled ? '#06beb6' : (dark ? '#555' : '#ccc');
    };

    const toggle = () => {
      enabled = !enabled;
      knob.style.left = enabled ? '22px' : '2px';
      updateTheme();
      onChange(enabled);
    };

    switchBtn.onclick = toggle;
    knob.style.left = '22px';
    updateTheme();

    new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    wrapper.append(label, switchBtn);
    container.appendChild(wrapper);
  }

  function openPhotoViewer(src, alt) {
    if (!photoViewer) {
      photoViewer = document.createElement('div');
      photoViewer.className = 'footprint-photo-viewer';
      photoViewer.innerHTML = `
        <div class="footprint-photo-viewer__mask"></div>
        <div class="footprint-photo-viewer__dialog">
          <button type="button" class="footprint-photo-viewer__close">&times;</button>
          <img alt="" />
        </div>`;
      document.body.appendChild(photoViewer);

      const close = () => {
        photoViewer.classList.remove('is-visible');
        document.documentElement.classList.remove('footprint-photo-viewer-open');
      };

      photoViewer.addEventListener('click', e => {
        if (e.target === photoViewer || e.target.classList.contains('footprint-photo-viewer__mask') || 
            e.target.classList.contains('footprint-photo-viewer__close')) close();
      });

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && photoViewer.classList.contains('is-visible')) close();
      });
    }

    const img = photoViewer.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    photoViewer.classList.add('is-visible');
    document.documentElement.classList.add('footprint-photo-viewer-open');
  }

  function registerThemeSync(map) {
    registeredMaps.add(map);
    if (themeObserver) return;

    themeObserver = new MutationObserver(() => {
      const style = getCurrentTheme();
      registeredMaps.forEach(m => {
        try { m.setMapStyle(style); } catch (e) {}
      });
    });

    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();