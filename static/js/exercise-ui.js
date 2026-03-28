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
      let points;
      if (!polyline || polyline === '') points = this.FALLBACK_POINTS;
      else {
        if (runObj && runObj._decodedCoords) points = runObj._decodedCoords;
        else {
          points = this.decode(polyline);
          if (points.length < 2) points = this.FALLBACK_POINTS;
          if (runObj && points !== this.FALLBACK_POINTS) runObj._decodedCoords = points; 
        }
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

  // ✨ 更新点1：加入 Stair 颜色
  window.KoobaiRun.SPORT_COLORS = {
    'Run': '#F58200', 'TrailRun': '#F58200', 'Treadmill': '#F58200', 'VirtualRun': '#F58200',
    'Ride': '#32D74B', 'EBikeRide': '#32D74B', 'VirtualRide': '#32D74B', 
    'Walk': '#DF40C4', 'Hike': '#DF40C4', 'Swim': '#0BAEE6', 'WaterSport': '#0BAEE6', 
    'StairStepper': '#007AFF', 'Stair': '#007AFF' 
  };

  // ✨ 更新点2：将分类彻底拆解为四大类：骑行、跑步、健走、登月
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
          if (iconRing) iconRing.innerHTML = window.KoobaiTrack.generate(runData.summary_polyline, 38, runData);
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
      let activeBg = 'rgba(50, 215, 75, 0.08)', activeBorder = 'rgba(50, 215, 75, 0.3)'; 
      if (targetId) {
        const targetRun = this.allRuns.find(r => normalizeId(r.run_id) === targetId);
        if (targetRun) {
          const activeColor = colorFromType(targetRun.type);
          let r = 50, g = 215, b = 75;
          if (activeColor.startsWith('#') && activeColor.length === 7) {
            r = parseInt(activeColor.slice(1, 3), 16); g = parseInt(activeColor.slice(3, 5), 16); b = parseInt(activeColor.slice(5, 7), 16);
          }
          activeBg = `rgba(${r}, ${g}, ${b}, 0.08)`; activeBorder = `rgba(${r}, ${g}, ${b}, 0.3)`; 
        }
      }
      document.querySelectorAll('.runCard').forEach(card => {
        const cardId = normalizeId(card.getAttribute('data-run-id'));
        if (targetId && cardId === targetId) { card.style.background = activeBg; card.style.borderColor = activeBorder; } 
        else { card.style.background = ''; card.style.borderColor = ''; }
      });
      document.querySelectorAll('.dayCell.hasRun').forEach(cell => {
        const cellId = normalizeId(cell.getAttribute('data-run-id'));
        if (targetId && cellId === targetId) { cell.style.borderColor = activeBorder; cell.style.background = activeBg; } 
        else { cell.style.borderColor = 'transparent'; cell.style.background = ''; }
      });
    }

    computeEngineData() {
      const displayYear = Number(this.currentYear);
      const filteredRuns = this.allRuns.filter(r => r.start_date_local?.startsWith(this.currentYear));
      const monthMap = new Map(), dateStats = new Map(), datesSet = new Set();
      
      // ✨ 更新点3：声明四个分类的统计变量
      let totalDist = 0, rideDist = 0, runDist = 0, walkDist = 0, stairDist = 0;
      
      const firstDayUTC = Date.UTC(displayYear, 0, 1), lastDayUTC = Date.UTC(displayYear, 11, 31);
      const totalWeeks = Math.ceil((lastDayUTC - firstDayUTC) / 86400000 / 7) + 1;
      const weekData = new Array(totalWeeks).fill(0);

      filteredRuns.forEach(r => {
        const dateStr = r.start_date_local.slice(0, 10);
        const month = Number(dateStr.slice(5, 7)) - 1;
        const utcTimestamp = new Date(`${dateStr}T00:00:00Z`).getTime();
        const distNum = (r.distance || 0) / 1000;
        r.hour = new Date(r.start_date_local).getHours();

        if (!monthMap.has(month)) monthMap.set(month, { runs: [], runsByDate: new Map() });
        monthMap.get(month).runs.push(r);
        if (!monthMap.get(month).runsByDate.has(dateStr)) monthMap.get(month).runsByDate.set(dateStr, []);
        monthMap.get(month).runsByDate.get(dateStr).push(r);

        totalDist += distNum; datesSet.add(utcTimestamp);
        const weekIdx = Math.max(0, Math.floor((utcTimestamp - firstDayUTC) / 86400000 / 7));
        weekData[weekIdx] += distNum;

        // ✨ 更新点4：按新类别入库统计
        if (RIDE_TYPES.has(r.type)) rideDist += distNum;
        else if (RUN_TYPES.has(r.type)) runDist += distNum;
        else if (WALK_TYPES.has(r.type)) walkDist += distNum;
        else if (STAIR_TYPES.has(r.type)) stairDist += distNum;
      });

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
      
      let mTotal = 0, mRide = 0, mRun = 0, mWalk = 0, mStair = 0, maxTimeBlockCount = 0, validHrRuns = 0;
      const timeBlocks = new Array(8).fill(0), hrCounts = new Array(5).fill(0);   

      currentMonthData.runs.forEach(r => {
        const d = (r.distance || 0) / 1000;
        mTotal += d;
        
        if (RIDE_TYPES.has(r.type)) mRide += d;
        else if (RUN_TYPES.has(r.type)) mRun += d;
        else if (WALK_TYPES.has(r.type)) mWalk += d;
        else if (STAIR_TYPES.has(r.type)) mStair += d;

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

      // ✨ 更新点5：将全部分类传入渲染引擎
      return {
        displayYear, availableMonths: Array.from(new Set(filteredRuns.map(r => r.start_date_local.slice(5, 7)))).sort().reverse(),
        global: { totalDist, rideDist, runDist, walkDist, stairDist, activeDays: datesSet.size, maxStreak, sparklineData },
        monthly: { 
          total: mTotal, rideDist: mRide, runDist: mRun, walkDist: mWalk, stairDist: mStair, runsByDate: currentMonthData.runsByDate,
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

        // ✨ 更新点6：排列 6 个元素的网格布局（带字体防挤压优化）
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

            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; width: 100%; z-index: 1;">
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">跑步</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.runDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">健走</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.walkDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">骑行</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.rideDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">登月</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.stairDist.toFixed(0)}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">km</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">出勤</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.activeDays}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">天</small></div></div>
              <div style="text-align: center;"><div style="color:#999; font-size:10px; margin-bottom:2px;">连签</div><div style="font-size:14px; font-weight:600; color: #333;">${engine.global.maxStreak}<small style="font-size:9px; font-weight:400; color:#999; margin-left:1px;">天</small></div></div>
            </div>
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
            const numDisplay = distNum > 0 
              ? `${distNum.toFixed(2)} <small class="ttUnit">km</small>`
              : `${r.moving_time || '--'} <small class="ttUnit">用时</small>`;
              
            return `
              <div class="ttItem" style="margin-bottom:8px;">
                <span class="ttName" style="font-size: 0.8rem; color: #666;">${window.KoobaiRun.getSmartName(r.name, r.type, r.summary_polyline)}</span>
                <span class="ttNum" style="color: ${colorFromType(r.type)}; font-weight: 600;">${numDisplay}</span>
              </div>
            `;
          }).join('');
          
          tooltipHtml = `<div class="runTooltip"><div class="ttDayRunList" style="display: flex; flex-direction: column;">${runListHtml}</div></div>`;
        }

        return `
          <div class="dayCell ${hasRun ? 'hasRun' : ''}" 
               data-run-id="${hasRun ? primaryRun.run_id : ''}"
               ${hasRun ? `onclick="window.KoobaiRun.map.flyTo('${primaryRun.run_id}')"` : ''} 
               style="height: 38px; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; border-radius: 8px; border: 1px solid transparent; transition: all 0.2s ease;">
            <span class="dateNum" style="font-size: 13px; color: ${hasRun ? '#333' : '#ccc'}; font-weight: ${hasRun ? '600' : '400'}; z-index: 1;">${day}</span>
            ${hasRun ? `<div style="width: 16px; height: 16px; margin-top: -6px; margin-bottom: 2px; color: ${runColor}; z-index: 1;">${window.KoobaiTrack.generate(primaryRun.summary_polyline, 16, primaryRun)}</div>` : ''}
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

      const hrZonesHtml = insights.hrCounts.map((count, i) => {
        const info = insights.hrZonesInfo[i];
        const percent = insights.validHrRuns > 0 ? Math.max(12, (count / insights.validHrRuns) * 100) : 12;
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

      // ✨ 更新点7：同步拆分日历框底部的当月情况统计，且支持 Flex 换行不重叠
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
            <span>本月运动<strong style="color: #333;">${engine.monthly.runsByDate.size}</strong>次，总里程 <strong style="color: #333;">${engine.monthly.total.toFixed(2)}</strong> km</span>
            <span>跑步 <strong style="color: #333;">${engine.monthly.runDist.toFixed(2)}</strong> km</span>
            <span>健走 <strong style="color: #333;">${engine.monthly.walkDist.toFixed(2)}</strong> km</span>
            <span>骑行 <strong style="color: #333;">${engine.monthly.rideDist.toFixed(2)}</strong> km</span>
            <span>登月 <strong style="color: #333;">${engine.monthly.stairDist.toFixed(2)}</strong> km</span>
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