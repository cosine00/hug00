(function() {
  'use strict';

  if (!window.KoobaiRun) window.KoobaiRun = {};

  window.KoobaiTrack = {
    FALLBACK_POINTS: [[3, 7], [7, 7], [8.5, 6.4], [9.5, 5], [8.5, 3.6], [7, 3], [3, 3], [1.5, 3.6], [0.5, 5], [1.5, 6.4], [3, 7]],
    decode: function(str) {
      let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null;
      while (index < str.length) {
        byte = null; shift = 0; result = 0;
        do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
        coordinates.push([lng / 1e5, lat / 1e5]);
      }
      return coordinates;
    },
    generate: function(polyline, size = 38, runObj = null) {
      if (!polyline || polyline === '') return null; 
      
      let points;
      if (runObj && runObj._decodedCoords) points = runObj._decodedCoords;
      else {
        points = this.decode(polyline);
        if (points.length < 2) return null; 
        if (runObj) runObj._decodedCoords = points; 
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      points.forEach(pt => {
        if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
      });
      const scale = Math.min((size * 0.95) / (maxX - minX || 1), (size * 0.95) / (maxY - minY || 1));
      const offX = (size - (maxX - minX) * scale) / 2;
      const offY = (size - (maxY - minY) * scale) / 2;
      let pathD = '';
      points.forEach((pt, index) => {
        const x = (pt[0] - minX) * scale + offX;
        const y = (maxY - minY - (pt[1] - minY)) * scale + offY;
        pathD += (index === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`);
      });
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><path d="${pathD}" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="path-track" /></svg>`;
    }
  };

  window.KoobaiRun.SPORT_COLORS = {
    'Run': '#F58200', 'TrailRun': '#F58200', 'Treadmill': '#F58200', 'VirtualRun': '#F58200',
    'Ride': '#32D74B', 'EBikeRide': '#32D74B', 'VirtualRide': '#32D74B', 
    'Walk': '#DF40C4', 'Hike': '#DF40C4', 'Swim': '#0BAEE6', 'WaterSport': '#0BAEE6', 
    'StairStepper': '#007AFF', 'Stair': '#007AFF' 
  };

  const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide']);
  const RUN_TYPES = new Set(['Run', 'TrailRun', 'Treadmill', 'VirtualRun']);
  const WALK_TYPES = new Set(['Walk', 'Hike']);
  const STAIR_TYPES = new Set(['StairStepper', 'Stair']);

  const colorFromType = (type) => window.KoobaiRun.SPORT_COLORS[type] || '#14C759';

  window.KoobaiRun.getSmartName = (name, type, polyline) => {
    const isDefaultPattern = /^(Morning|Afternoon|Evening|Night|Lunch|Run|Ride|Walk|Swim|Hike|晨间|下午|晚间|夜间)/i.test(name);
    if (!isDefaultPattern && name && name.length > 0) return name;
    const typeMap = { 'Run': '跑起来', 'Ride': '骑起来', 'Walk': '走起来', 'Swim': '游起来', 'Stair': '登月爬楼' };
    return typeMap[type] || '运动';
  };

  const getActivityIcon = (type) => {
    if (STAIR_TYPES.has(type)) {
      return `<svg class="custom-sport-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M372.849778 0a92.16 92.16 0 1 0 0 184.32 92.16 92.16 0 0 0 0-184.32z m-92.16 182.385778c-6.144 0-14.563556 1.934222-16.668445 1.934222l-153.6 34.531556a33.393778 33.393778 0 0 0-26.168889 23.096888L27.192889 373.134222c-8.192 18.375111-0.398222 39.992889 20.48 49.265778 20.878222 9.272889 44.373333-6.144 50.574222-20.48l47.331556-111.388444 67.185777-15.928889-53.077333 210.488889c-12.344889 53.304889 18.375111 82.432 40.96 84.536888l151.665778 26.168889 20.48 158.151111c4.096 24.519111 22.755556 40.96 47.331555 40.96h5.802667c26.624-4.096 43.008-27.136 40.96-53.816888L440.661333 552.96C438.613333 532.48 422.115556 516.096 401.635556 512l-83.854223-16.668444 34.588445-157.411556 51.2 75.491556a38.684444 38.684444 0 0 0 32.654222 18.602666c4.039111 0 8.078222 0.170667 12.117333-1.934222l133.12-44.145778c20.48-10.24 31.118222-30.72 25.031111-51.2a37.717333 37.717333 0 0 0-47.388444-24.348444l-106.268444 35.84S379.221333 237.283556 368.981333 218.851556c-10.24-18.375111-24.519111-22.129778-40.96-26.168889 0 0-37.091556-10.24-47.331555-10.24z m512 309.134222v102.4h-143.36v102.4h-143.36v102.4h-143.36v102.4h-143.36V1024h40.96v-81.92h143.36v-102.4h143.36v-102.4h143.36v-102.4h143.36v-102.4h143.36v-40.96h-184.32zM155.875556 592.611556l-18.545778 58.936888-123.505778 124.757334a47.786667 47.786667 0 0 0 0 67.185778c10.24 8.192 20.309333 14.791111 32.597333 14.791111 12.344889 0 24.462222-4.551111 32.654223-14.791111l131.868444-133.12a48.184889 48.184889 0 0 0 12.117333-22.357334l17.92-69.745778-46.08-8.362666a81.92 81.92 0 0 1-39.025777-17.237334z"/></svg>`;
    }
    return `<svg class="custom-sport-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`;
  };

  class UIEngine {
    constructor(allRuns) {
      this.allRuns = allRuns || [];
      const firstYearBtn = document.querySelector('#year-nav .button');
      this.currentYear = firstYearBtn ? firstYearBtn.getAttribute('data-year') : "2026";
      this.listMonth = 'All';
      this.setSmartMonth(); 
      this.replaceIconsWithTracks();
    }
    
    replaceIconsWithTracks() {
      const normalizeId = (id) => String(Number(String(id).replace(/,/g, '')));
      const runMap = new Map();
      this.allRuns.forEach(r => runMap.set(normalizeId(r.run_id), r));
      document.querySelectorAll('.runCard').forEach(card => {
        const runId = card.getAttribute('data-run-id');
        const runData = runMap.get(normalizeId(runId));
        if (runData) {
          const iconRing = card.querySelector('.iconRing');
          if (iconRing) {
            const trackSvg = window.KoobaiTrack.generate(runData.summary_polyline, 38, runData);
            iconRing.innerHTML = trackSvg || getActivityIcon(runData.type); 
          }
        }
      });
    }

    setSmartMonth() {
      const runsInYear = this.allRuns.filter(r => r.start_date_local?.startsWith(this.currentYear));
      this.calMonthIndex = runsInYear.length > 0 ? Math.max(...runsInYear.map(r => parseInt(r.start_date_local.substring(5, 7), 10) - 1)) : new Date().getMonth();
    }

    setYear(year) {
      this.currentYear = year;
      document.querySelectorAll('#year-nav .button').forEach(btn => btn.classList.toggle('selected', btn.getAttribute('data-year') === year));
      this.setSmartMonth();
      this.renderAll();
    }

    setCalMonth(dir) {
      this.calMonthIndex = Math.max(0, Math.min(11, this.calMonthIndex + dir));
      this.renderCalendar(this.computeEngineData());
    }

    setListMonth(monthStr) {
      this.listMonth = monthStr;
      this.renderMonthFilterUI(); 
      document.querySelectorAll('.runCard').forEach(card => {
        const isYearMatch = card.classList.contains(`item-year-${this.currentYear}`);
        const isMonthMatch = this.listMonth === 'All' || card.classList.contains(`item-month-${this.listMonth}`);
        card.style.display = (isYearMatch && isMonthMatch) ? 'flex' : 'none';
      });
    }

    highlightRunInUI(runId) {
      const normalizeId = (id) => {
        if (!id || id === 'undefined' || id === 'null') return null;
        return String(Number(String(id).replace(/,/g, '')));
      };
      const targetId = normalizeId(runId);
      
      let activeBg = 'rgba(50, 215, 75, 0.08)', activeBorder = 'rgba(50, 215, 75, 0.3)', activeColor = '#32D74B'; 
      if (targetId) {
        const targetRun = this.allRuns.find(r => normalizeId(r.run_id) === targetId);
        if (targetRun) {
          activeColor = colorFromType(targetRun.type);
          let r = 50, g = 215, b = 75;
          if (activeColor.startsWith('#') && activeColor.length === 7) {
            r = parseInt(activeColor.slice(1, 3), 16); g = parseInt(activeColor.slice(3, 5), 16); b = parseInt(activeColor.slice(5, 7), 16);
          }
          activeBg = `rgba(${r}, ${g}, ${b}, 0.08)`; activeBorder = `rgba(${r}, ${g}, ${b}, 0.3)`; 
        }
      }
      
      document.querySelectorAll('.runCard').forEach(card => {
        const cardId = normalizeId(card.getAttribute('data-run-id'));
        if (targetId && cardId === targetId) { 
          card.style.background = activeBg; card.style.borderColor = activeBorder; 
          card.classList.add('is-active');
          card.style.setProperty('--active-icon-color', activeColor);
        } else { 
          card.style.background = ''; card.style.borderColor = ''; 
          card.classList.remove('is-active');
          card.style.removeProperty('--active-icon-color');
        }
      });
      
      document.querySelectorAll('.dayCell.hasRun').forEach(cell => {
        const cellId = normalizeId(cell.getAttribute('data-run-id'));
        if (targetId && cellId === targetId) { 
          cell.style.borderColor = activeBorder; cell.style.background = activeBg; 
          cell.classList.add('is-active');
          cell.style.setProperty('--active-icon-color', activeColor);
        } else { 
          cell.style.borderColor = 'transparent'; cell.style.background = ''; 
          cell.classList.remove('is-active');
          cell.style.removeProperty('--active-icon-color');
        }
      });
    }

    computeEngineData() {
      const parseDurationToHours = (timeStr) => {
        if (!timeStr) return 0;
        const parts = timeStr.toString().split(':').map(Number);
        if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
        if (parts.length === 2) return parts[0] / 60 + parts[1] / 3600;
        return 0;
      };

      const displayYear = Number(this.currentYear);
      const filteredRuns = this.allRuns.filter(r => r.start_date_local?.startsWith(this.currentYear));
      const monthMap = new Map(), dateStats = new Map(), datesSet = new Set();
      
      let totalDist = 0, rideDist = 0, runDist = 0, walkDist = 0, stairDuration = 0;
      const cityDataMap = new Map(); 
      
      let calRideYMax = 0, calRideYId = null, calRidePaceMax = 0, calRidePaceId = null;
      let calRwYMax = 0, calRwYId = null, calRwYPaceMin = Infinity, calRwYPaceId = null;
      let calStairYMax = 0, calStairYId = null;
      const monthRideMax = new Map(), monthRidePaceMax = new Map();
      const monthRwMax = new Map(), monthRwPaceMin = new Map();
      const monthStairMax = new Map();

      const firstDayUTC = Date.UTC(displayYear, 0, 1), lastDayUTC = Date.UTC(displayYear, 11, 31);
      const totalWeeks = Math.ceil((lastDayUTC - firstDayUTC) / 86400000 / 7) + 1;
      const weekData = new Array(totalWeeks).fill(0);

      filteredRuns.forEach(r => {
        const dateStr = r.start_date_local.slice(0, 10);
        const month = Number(dateStr.slice(5, 7)) - 1;
        const utcTimestamp = new Date(`${dateStr}T00:00:00Z`).getTime();
        const distNum = (r.distance || 0) / 1000;
        const durHours = parseDurationToHours(r.moving_time);
        r.hour = new Date(r.start_date_local).getHours();

        if (!monthMap.has(month)) monthMap.set(month, { runs: [], runsByDate: new Map() });
        monthMap.get(month).runs.push(r);
        if (!monthMap.get(month).runsByDate.has(dateStr)) monthMap.get(month).runsByDate.set(dateStr, []);
        monthMap.get(month).runsByDate.get(dateStr).push(r);

        totalDist += distNum; datesSet.add(utcTimestamp);
        const weekIdx = Math.max(0, Math.floor((utcTimestamp - firstDayUTC) / 86400000 / 7));
        weekData[weekIdx] += distNum;

        const runIdStr = String(r.run_id);

        if (RIDE_TYPES.has(r.type)) {
          rideDist += distNum;
          if (distNum > calRideYMax) { calRideYMax = distNum; calRideYId = runIdStr; }
          const mMax = monthRideMax.get(month) || { dist: 0, id: null };
          if (distNum > mMax.dist) monthRideMax.set(month, { dist: distNum, id: runIdStr });
          
          if (distNum > 5 && r.average_speed > 0) {
            if (r.average_speed > calRidePaceMax) { calRidePaceMax = r.average_speed; calRidePaceId = runIdStr; }
            const mPaceMax = monthRidePaceMax.get(month) || { speed: 0, id: null };
            if (r.average_speed > mPaceMax.speed) monthRidePaceMax.set(month, { speed: r.average_speed, id: runIdStr });
          }
        } 
        else if (RUN_TYPES.has(r.type) || WALK_TYPES.has(r.type)) {
          if (RUN_TYPES.has(r.type)) runDist += distNum; else walkDist += distNum;
          
          if (distNum > calRwYMax) { calRwYMax = distNum; calRwYId = runIdStr; }
          const mMax = monthRwMax.get(month) || { dist: 0, id: null };
          if (distNum > mMax.dist) monthRwMax.set(month, { dist: distNum, id: runIdStr });

          if (distNum > 1 && r.average_speed > 0) {
            const currentPace = 1000 / r.average_speed; 
            if (currentPace < calRwYPaceMin) { calRwYPaceMin = currentPace; calRwYPaceId = runIdStr; }
            const mPaceMin = monthRwPaceMin.get(month) || { pace: Infinity, id: null };
            if (currentPace < mPaceMin.pace) monthRwPaceMin.set(month, { pace: currentPace, id: runIdStr });
          }
        } 
        else if (STAIR_TYPES.has(r.type)) {
          stairDuration += durHours;
          if (durHours > calStairYMax) { calStairYMax = durHours; calStairYId = runIdStr; }
          const mMax = monthStairMax.get(month) || { dur: 0, id: null };
          if (durHours > mMax.dur) monthStairMax.set(month, { dur: durHours, id: runIdStr });
        }

        const formatCity = (rawStr) => {
          if (!rawStr || rawStr === 'null' || rawStr === 'undefined') return { name: '深圳市', isForeign: false };
          
          if (/香港|Hong\s*Kong|HK/i.test(rawStr)) return { name: '香港特别行政区', isForeign: false };
          if (/澳门|Macao|Macau|嘉模堂区/i.test(rawStr)) return { name: '澳门特别行政区', isForeign: false };
          if (/台湾|Taiwan/i.test(rawStr)) return { name: '台湾省', isForeign: false };
          if (/横琴/i.test(rawStr)) return { name: '珠海市', isForeign: false };
          if (/坪山|南山|福田|罗湖|宝安|龙岗|龙华|盐田|光明|大鹏/i.test(rawStr)) return { name: '深圳市', isForeign: false };
          if (/惠城|博罗|惠阳|惠东|龙门/i.test(rawStr)) return { name: '惠州市', isForeign: false };

          let parts = rawStr.split(/[,，]/).map(p => p.trim()).filter(p => p);
          let nonEnglishParts = parts.filter(p => !/^[\d\sA-Za-z&_.-]+$/.test(p));
          let validParts = nonEnglishParts.length > 0 ? nonEnglishParts : parts;
          validParts = validParts.filter(p => !/中国|China|PRC/i.test(p));
          
          if (validParts.length === 0) return { name: '深圳市', isForeign: false }; 

          const cnProvinces = ['北京', '天津', '河北', '山西', '内蒙', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];
          const isDomestic = /中国|China/i.test(rawStr) || cnProvinces.some(prov => rawStr.includes(prov));

          let lastPart = validParts[validParts.length - 1];

          if (!isDomestic) {
              return { name: lastPart, isForeign: true }; 
          }

          let city = '', district = '';
          const directCities = new Set(['北京市', '上海市', '天津市', '重庆市', '北京', '上海', '天津', '重庆']);
          let isDirectCity = false;

          for (let i = validParts.length - 1; i >= 0; i--) {
            let p = validParts[i];
            if (directCities.has(p)) {
                isDirectCity = true;
            } else if (p.endsWith('市') || p.endsWith('自治州') || p.endsWith('地区') || p.endsWith('盟')) {
                if (!city) city = p;
            } else if (p.endsWith('区') || p.endsWith('县') || p.endsWith('旗')) {
                if (!district) district = p;
            }
          }

          if (isDirectCity && district) return { name: district, isForeign: false }; 
          if (city) return { name: city, isForeign: false }; 
          if (isDirectCity) {
            let dc = validParts.find(p => directCities.has(p));
            return { name: dc.endsWith('市') ? dc : dc + '市', isForeign: false }; 
          }
          if (district) return { name: district, isForeign: false }; 

          return { name: '深圳市', isForeign: false }; 
        };

        let cityObj = formatCity(r.location_country);
        
        if (cityObj && cityObj.name) {
            let existing = cityDataMap.get(cityObj.name);
            if (!existing) {
                existing = { name: cityObj.name, dist: 0, isForeign: cityObj.isForeign };
                cityDataMap.set(cityObj.name, existing);
            }
            existing.dist += distNum; 
        }
      });

      const sortedCities = Array.from(cityDataMap.values()).sort((a, b) => {
          if (a.isForeign !== b.isForeign) return a.isForeign ? 1 : -1;
          return b.dist - a.dist;
      }).map(c => `${c.name} ${Math.round(c.dist)}km`);

      const calRideMIds = new Set(), calRwMIds = new Set(), calStairMIds = new Set();
      const calRwPaceMIds = new Set(), calRidePaceMIds = new Set();
      monthRideMax.forEach(v => { if (v.id) calRideMIds.add(v.id); });
      monthRwMax.forEach(v => { if (v.id) calRwMIds.add(v.id); });
      monthStairMax.forEach(v => { if (v.id) calStairMIds.add(v.id); });
      monthRwPaceMin.forEach(v => { if (v.id) calRwPaceMIds.add(v.id); }); 
      monthRidePaceMax.forEach(v => { if (v.id) calRidePaceMIds.add(v.id); });

      let maxStreak = 0;
      if (datesSet.size > 0) {
        const timestamps = Array.from(datesSet).sort((a, b) => a - b);
        maxStreak = 1; let currStreak = 1;
        for (let i = 1; i < timestamps.length; i++) {
          const diffDays = (timestamps[i] - timestamps[i - 1]) / 86400000;
          if (diffDays === 1) maxStreak = Math.max(maxStreak, ++currStreak);
          else if (diffDays > 1) currStreak = 1;
        }
      }

      const sparklineData = weekData.map((val, i, arr) => (arr[i-1]||val)*0.2 + val*0.6 + (arr[i+1]||val)*0.2);
      const currentMonthData = monthMap.get(this.calMonthIndex) || { runs: [], runsByDate: new Map() };
      
      let mTotal = 0, mRide = 0, mRun = 0, mWalk = 0, mStairDur = 0, maxTimeBlockCount = 0, validHrRuns = 0;
      const timeBlocks = new Array(8).fill(0), hrCounts = new Array(5).fill(0);   

      currentMonthData.runs.forEach(r => {
        const d = (r.distance || 0) / 1000;
        const hw = parseDurationToHours(r.moving_time);
        mTotal += d;
        if (RIDE_TYPES.has(r.type)) mRide += d;
        else if (RUN_TYPES.has(r.type)) mRun += d;
        else if (WALK_TYPES.has(r.type)) mWalk += d;
        else if (STAIR_TYPES.has(r.type)) mStairDur += hw;

        const blockIdx = Math.floor(r.hour / 3);
        if (++timeBlocks[blockIdx] > maxTimeBlockCount) maxTimeBlockCount = timeBlocks[blockIdx];
        if (r.average_heartrate && r.average_heartrate > 0) {
          validHrRuns++;
          const hr = r.average_heartrate;
          const zoneIndex = hr < 115 ? 0 : hr < 130 ? 1 : hr < 145 ? 2 : hr < 160 ? 3 : 4;
          hrCounts[zoneIndex]++;
        }
      });

      const personas = [ { name: '午夜潜行', time: '00:00-03:00' }, { name: '破晓先锋', time: '03:00-06:00' }, { name: '晨光逐风', time: '06:00-09:00' }, { name: '骄阳行者', time: '09:00-12:00' }, { name: '烈日独行', time: '12:00-15:00' }, { name: '午后追风', time: '15:00-18:00' }, { name: '暮色掠影', time: '18:00-21:00' }, { name: '暗夜游侠', time: '21:00-24:00' } ];
      const hrZonesInfo = [ { color: '#32D74B', title: '舒缓有氧', name: 'Z1', range: '<115' }, { color: '#FFCC00', title: '稳态燃脂', name: 'Z2', range: '115-129' }, { color: '#FF9500', title: '有氧强化', name: 'Z3', range: '130-144' }, { color: '#FF5E3A', title: '乳酸阈值', name: 'Z4', range: '145-159' }, { color: '#FF3B30', title: '无氧极限', name: 'Z5', range: '≥160' } ];

      return {
        displayYear, availableMonths: Array.from(new Set(filteredRuns.map(r => r.start_date_local.slice(5, 7)))).sort().reverse(),
        global: { 
          totalDist, rideDist, runDist, walkDist, stairDuration, activeDays: datesSet.size, maxStreak, sparklineData, sortedCities,
          achieve: { calRideYId, calRideMIds, calRwYId, calRwMIds, calStairYId, calStairMIds, calRwYPaceId, calRwPaceMIds, calRidePaceId, calRidePaceMIds }
        },
        monthly: { 
          total: mTotal, rideDist: mRide, runDist: mRun, walkDist: mWalk, stairDuration: mStairDur, runsByDate: currentMonthData.runsByDate,
          totalRunsCount: currentMonthData.runs.length, // <--- 新增这一句：获取本月实际活动总数
          insights: { 
            hasActivities: currentMonthData.runs.length > 0, timeBlocks, maxTimeBlockCount: Math.max(maxTimeBlockCount, 1), peakPersona: maxTimeBlockCount > 0 ? personas[timeBlocks.indexOf(maxTimeBlockCount)].name : '等待记录', 
            personas, validHrRuns, hrCounts, hrZonesInfo, hrMaxZone: hrZonesInfo[hrCounts.indexOf(Math.max(...hrCounts))] || hrZonesInfo[0] 
          }
        }
      };
    }

    renderAll() {
      const engine = this.computeEngineData();
      this.renderMonthFilterUI(engine.availableMonths);
      this.setListMonth('All');
      this.renderCalendar(engine);
      this.addPillsToCards(engine);
    }

    addPillsToCards(engine) {
      document.querySelectorAll('.runCard').forEach(card => {
        const runId = card.getAttribute('data-run-id');
        if (!runId) return;
        const nId = String(Number(String(runId).replace(/,/g, '')));
        const runData = this.allRuns.find(r => String(Number(String(r.run_id).replace(/,/g, ''))) === nId);
        if (!runData) return;

        let pills = [];
        let injectTooltipRows = [];
        const ach = engine.global.achieve;

        if (RIDE_TYPES.has(runData.type)) {
          if (nId === String(ach.calRideYId)) pills.push({ text: '年度最远', gold: true });
          else if (ach.calRideMIds.has(nId)) pills.push({ text: '月度最远', gold: false });
          
          if (nId === String(ach.calRidePaceId)) { 
            pills.push({ text: '年度最快', gold: true }); 
            injectTooltipRows.push('<div class="ttAchieveRow"><span>年度最快</span><span class="titleTag">骑行</span></div>');
          } else if (ach.calRidePaceMIds.has(nId)) { 
            pills.push({ text: '月度最快', gold: false }); 
            injectTooltipRows.push('<div class="ttAchieveRow"><span>月度最快</span><span class="titleTag">骑行</span></div>');
          }
        } else if (RUN_TYPES.has(runData.type) || WALK_TYPES.has(runData.type)) {
          if (nId === String(ach.calRwYId)) pills.push({ text: '年度最远', gold: true });
          else if (ach.calRwMIds.has(nId)) pills.push({ text: '月度最远', gold: false });
          
          if (nId === String(ach.calRwYPaceId)) { 
            pills.push({ text: '年度最快', gold: true }); 
            injectTooltipRows.push('<div class="ttAchieveRow"><span>年度最快</span><span class="titleTag">跑走</span></div>');
          } else if (ach.calRwPaceMIds.has(nId)) { 
            pills.push({ text: '月度最快', gold: false }); 
            injectTooltipRows.push('<div class="ttAchieveRow"><span>月度最快</span><span class="titleTag">跑走</span></div>');
          }
        } else if (STAIR_TYPES.has(runData.type)) {
          if (nId === String(ach.calStairYId)) pills.push({ text: '年度最久', gold: true });
          else if (ach.calStairMIds.has(nId)) pills.push({ text: '月度最久', gold: false });
        }

        const nameEl = card.querySelector('.runName');
        if (nameEl && pills.length > 0) {
          pills.forEach(p => {
            const colorClass = p.gold ? 'gold-pill' : 'silver-pill';
            nameEl.insertAdjacentHTML('beforeend', `<span class="card-achievement-pill ${colorClass}">${p.text}</span>`);
          });
        }

        if (injectTooltipRows.length > 0) {
          const tooltipList = card.querySelector('.ttList');
          if (tooltipList) {
            tooltipList.insertAdjacentHTML('beforeend', injectTooltipRows.join(''));
          }
        }
      });
    }

    renderMonthFilterUI(monthsArr) {
      const container = document.getElementById('month-filter-bar');
      if (!container) return;
      const arr = monthsArr || Array.from(new Set(this.allRuns.filter(r => r.start_date_local?.startsWith(this.currentYear)).map(r => r.start_date_local.slice(5, 7)))).sort().reverse();
      const pills = arr.map(m => `<div class="filterPill ${this.listMonth === m ? 'activePill' : ''}" onclick="window.KoobaiRun.ui.setListMonth('${m}')">${m}</div>`).join('');
      container.innerHTML = `<div class="filterPill ${this.listMonth === 'All' ? 'activePill' : ''}" onclick="window.KoobaiRun.ui.setListMonth('All')">全部</div>${pills}<div class="monthLabel">月</div>`;
    }

    renderCalendar(engine) {
      const globalStatsContainer = document.getElementById('global-stats');
      const container = document.getElementById('calendar-board-container');

      if (globalStatsContainer) {
        let path = "";
        if (engine.global.sparklineData.length > 0) {
            const maxVal = Math.max(...engine.global.sparklineData, 1);
            const points = engine.global.sparklineData.map((v, i) => `${(i/Math.max(engine.global.sparklineData.length-1, 1))*200},${40 - (v/maxVal)*30}`);
            path = `
              <path d="M 0,40 L ${points.join(' L ')} L 200,40 Z" fill="rgba(50, 215, 75, 0.08)" stroke="none" />
              <path d="M ${points.join(' L ')}" fill="none" stroke="rgba(50, 215, 75, 0.35)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            `;
        }

        globalStatsContainer.innerHTML = `
          <div style="padding: 16px 20px; position: relative; text-align: center; overflow: hidden; display: flex; flex-direction: column; align-items: center; background: #fff; border-radius: 16px; border: 1px solid #e5e5e5; margin-bottom: 15px;">
            <div style="font-size: 12px; color: #999; margin-bottom: 2px; z-index: 1; letter-spacing: 1px;">年度总里程</div>
            <div style="display: flex; align-items: baseline; justify-content: center; gap: 4px; margin-bottom: 12px; z-index: 1;">
              <span style="font-size: 40px; font-weight: 800; color: #32D74B; line-height: 1;">${engine.global.totalDist.toFixed(2)}</span>
              <span style="font-size: 13px; color: #999; font-weight: 600; text-transform: uppercase;">KM</span>
            </div>

            <div style="position: relative; width: 100%; margin-bottom: 12px;">
              <svg style="position: absolute; bottom: 0; left: -20px; width: calc(100% + 40px); height: 60px; z-index: 0; pointer-events: none;" viewBox="0 0 200 40" preserveAspectRatio="none">${path}</svg>
              <div style="width: 100%; height: 1px; background: rgba(50, 215, 75, 0.15); position: relative; z-index: 1;"></div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; width: 100%; z-index: 1;">
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">跑步</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.runDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">健走</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.walkDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">骑行</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.rideDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">登月</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.stairDuration.toFixed(1)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">h</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">出勤</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.activeDays}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">天</small></div></div>              
            </div>

            ${engine.global.sortedCities && engine.global.sortedCities.length > 0 ? `
            <div style="width: 100%; margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(50, 215, 75, 0.2); text-align: center; font-size: 11.5px; z-index: 1; display: flex; justify-content: center; line-height: 1.6;">
              <div style="max-width: 95%; word-break: break-all;">
                <span style="color: #d732ab; margin-right: 6px; font-weight: 700; font-size: 12px;">
                  <svg style="width:12px; height:12px; display:inline-block; vertical-align:-2px; margin-right:2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>足迹
                </span>
                ${engine.global.sortedCities.map((city, idx) => `<span style="color: ${idx % 2 === 0 ? '#914646' : '#1f9c74'}; font-weight: 500;">${city}</span>`).join('<span style="color: #ccc; margin: 0 2px;">、</span>')}
              </div>
            </div>` : ''}

          </div>`;
      }

      if (!container) return;

      const firstDay = (new Date(engine.displayYear, this.calMonthIndex, 1).getDay() + 6) % 7;
      const daysInMonth = new Date(engine.displayYear, this.calMonthIndex + 1, 0).getDate();
      const daysArr = Array.from({ length: firstDay }, () => null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

      const gridHtml = daysArr.map(day => {
        if (!day) return `<div style="height: 38px;"></div>`;
        const dateStr = `${engine.displayYear}-${String(this.calMonthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayRuns = engine.monthly.runsByDate.get(dateStr) || [];
        const hasRun = dayRuns.length > 0;
        const primaryRun = hasRun ? dayRuns[0] : null;
        const runColor = hasRun ? colorFromType(primaryRun.type) : 'transparent';
        
        let tooltipHtml = '';
        if (hasRun) {
          const runListHtml = dayRuns.map(r => {
            const distNum = (r.distance || 0) / 1000;
            const isStair = STAIR_TYPES.has(r.type);
            const numDisplay = isStair 
              ? `${r.moving_time}`
              : (distNum > 0 ? `${(Math.floor(distNum * 100) / 100).toFixed(2)} <small class="ttUnit">km</small>` : `${r.moving_time || '--'} <small class="ttUnit">用时</small>`);
              
            return `
              <div class="ttItem" style="margin-bottom:8px;">
                <span class="ttName" style="font-size: 0.8rem; color: #666;">${window.KoobaiRun.getSmartName(r.name, r.type, r.summary_polyline)}</span>
                <span class="ttNum" style="color: ${colorFromType(r.type)}; font-weight: 600;">${numDisplay}</span>
              </div>
            `;
          }).join('');
          
          tooltipHtml = `<div class="runTooltip"><div class="ttDayRunList" style="display: flex; flex-direction: column;">${runListHtml}</div></div>`;
        }

        let cellIcon = '';
        if (hasRun) {
            const svgTrack = window.KoobaiTrack.generate(primaryRun.summary_polyline, 16, primaryRun);
            cellIcon = svgTrack || getActivityIcon(primaryRun.type);
        }

        return `
          <div class="dayCell ${hasRun ? 'hasRun' : ''}" 
               data-run-id="${hasRun ? primaryRun.run_id : ''}"
               ${hasRun ? `onclick="window.KoobaiRun.map.flyTo('${primaryRun.run_id}')"` : ''} 
               style="height: 38px; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; border-radius: 8px; border: 1px solid transparent; transition: all 0.2s ease;">
            <span class="dateNum" style="font-size: 13px; color: ${hasRun ? '#333' : '#ccc'}; font-weight: ${hasRun ? '600' : '400'}; z-index: 1;">${day}</span>
            ${hasRun ? `<div class="calIconRing" style="width: 16px; height: 16px; margin-top: -6px; margin-bottom: 2px; display:flex; justify-content:center; align-items:center; color: ${runColor}; z-index: 1;">${cellIcon}</div>` : ''}
            ${tooltipHtml}
          </div>`;
      }).join('');

      const insights = engine.monthly.insights;
      
      const timeBlocksHtml = insights.timeBlocks.map((count, i) => {
        const heightRatio = insights.maxTimeBlockCount > 0 ? (count / insights.maxTimeBlockCount) : 0;
        const bgStyle = count > 0 ? `style="background-color: rgba(50, 215, 75, ${0.3 + 0.7 * heightRatio})"` : '';
        return `
          <div class="barWrapper">
            <div class="punchHole" ${bgStyle}></div>
            <div class="runTooltip">
              <div class="ttItem" style="display: flex; gap: 12px; justify-content: center; margin-bottom: 0;">
                <span class="ttName" style="font-size: 0.75rem; color: #666;">${insights.personas[i].time}</span>
                <span class="ttNum">${count} <small>趟</small></span>
              </div>
            </div>
          </div>`;
      }).join('');

      const maxHrCount = Math.max(...insights.hrCounts); 
      const hrZonesHtml = insights.hrCounts.map((count, i) => {
        const info = insights.hrZonesInfo[i];
        const percent = maxHrCount > 0 ? Math.max(12, (count / maxHrCount) * 100) : 12;
        const bgStyle = count > 0 ? `background-color: ${info.color}` : '';
        return `
          <div class="zoneCol">
            <div class="zoneBar" style="height: ${percent}%; ${bgStyle}"></div>
            <div class="runTooltip">
              <div class="ttItem" style="display: flex; gap: 12px; justify-content: center; margin-bottom: 0;">
                <span class="ttName" style="color: ${info.color}; font-size: 0.75rem;">${info.range} <small>BPM</small></span>
                <span class="ttNum">${count} <small>趟</small></span>
              </div>
            </div>
          </div>`;
      }).join('');

      container.innerHTML = `
        <div style="background: #fff; border-radius: 16px; padding: 16px; border: 1px solid #e5e5e5; margin-bottom: 12px;">
          <div style="display: flex; justify-content: center; align-items: center; gap: 24px; margin-bottom: 12px;">
            <button onclick="window.KoobaiRun.ui.setCalMonth(-1)" style="border:none; background:none; cursor:pointer; font-size:18px; color:#999;">&lsaquo;</button>
            <span style="font-size: 16px; font-weight: 700; color: #333;">${engine.displayYear}-${String(this.calMonthIndex + 1).padStart(2, '0')}</span>
            <button onclick="window.KoobaiRun.ui.setCalMonth(1)" style="border:none; background:none; cursor:pointer; font-size:18px; color:#999;">&rsaquo;</button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 11px; color: #bbb; margin-bottom: 8px; font-weight: 500;">
            <div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div><div>日</div>
          </div>
          <div class="grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
            ${gridHtml}
          </div>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #eee; text-align: center; font-size: 11px; color: #999; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;">
            <span>本月运动<strong style="color: #333;">${engine.monthly.totalRunsCount}</strong>次，总里程 <strong style="color: #333;">${engine.monthly.total.toFixed(2)}</strong> km</span>
            <span>跑步 <strong style="color: #333;">${engine.monthly.runDist.toFixed(2)}</strong> km</span>
            <span>健走 <strong style="color: #333;">${engine.monthly.walkDist.toFixed(2)}</strong> km</span>
            <span>骑行 <strong style="color: #333;">${engine.monthly.rideDist.toFixed(2)}</strong> km</span>
            <span>登月 <strong style="color: #333;">${engine.monthly.stairDuration.toFixed(1)}</strong> h</span>
          </div>
        </div>

        <div class="monthlyInsights" style="display: flex; gap: 10px;">
          <div class="insightCard" style="flex: 1; background: #fff; border-radius: 16px; padding: 12px 16px; border: 1px solid #e5e5e5;">
            <div class="insightHeader" style="font-size: 0.75rem; color: #999; margin-bottom: 10px;"><span class="insightTitle">${insights.peakPersona}</span></div>
            <div class="insightContent">
              <div class="punchCard" style="display: flex; gap: 4px; height: 15px;">${timeBlocksHtml}</div>
              <div class="insightLabels timeLabels" style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.55rem; color: #999; opacity: 0.6;">
                <span style="text-align: left;">00:00</span>
                <span style="text-align: center; flex: 1;">12:00</span>
                <span style="text-align: right;">24:00</span>
              </div>
            </div>
          </div>
          
          <div class="insightCard" style="flex: 1; background: #fff; border-radius: 16px; padding: 12px 16px; border: 1px solid #e5e5e5;">
            <div class="insightHeader" style="font-size: 0.75rem; color: #999; margin-bottom: 10px;"><span class="insightTitle">${insights.hasActivities ? insights.hrMaxZone.title : '等待记录'}</span></div>
            <div class="insightContent">
              <div class="zoneChart" style="display: flex; gap: 10px; height: 15px; align-items: flex-end;">${hrZonesHtml}</div>
              <div class="insightLabels zoneLabels" style="display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; font-size: 0.55rem; color: #999; opacity: 0.6;">
                ${insights.hrZonesInfo.map(i => `<span style="flex: 1; text-align: center; min-width: 0;">${i.name}</span>`).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.KoobaiRun && window.KoobaiRun.data) {
      window.KoobaiRun.ui = new UIEngine(window.KoobaiRun.data);
      window.KoobaiRun.ui.renderAll();
    }
  });

})();
