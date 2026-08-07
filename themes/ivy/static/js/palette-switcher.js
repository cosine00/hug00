(function () {
  'use strict';

  var order = ['paper', 'night', 'sepia', 'mist'];
  var palettes = {
    paper: { label: '明亮', color: '#fafafa', dark: false },
    night: { label: '夜幕', color: '#17191d', dark: true },
    sepia: { label: '暖纸', color: '#f4efe4', dark: false },
    mist: { label: '雾蓝', color: '#edf3f6', dark: false }
  };
  var root = document.documentElement;
  var trigger = document.querySelector('.palette-trigger');
  if (!trigger) return;
  var initialIndex = order.indexOf(root.dataset.theme);
  var rotation = Math.max(0, initialIndex) * 90;
  trigger.style.setProperty('--palette-rotation', rotation + 'deg');

  function applyPalette(name, persist) {
    if (!palettes[name]) name = 'paper';
    var palette = palettes[name];
    root.dataset.theme = name;
    root.style.colorScheme = palette.dark ? 'dark' : 'light';
    root.classList.toggle('dark', palette.dark);
    document.body.classList.toggle('dark', palette.dark);
    document.body.classList.toggle('dark-theme', palette.dark);
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = palette.color;
    trigger.title = palette.label;
    trigger.setAttribute('aria-label', '当前色调：' + palette.label + '，点击切换');
    if (persist) localStorage.setItem('blog-palette', name);
    window.dispatchEvent(new CustomEvent('blogpalettechange', {
      detail: { theme: name, dark: palette.dark }
    }));
  }

  trigger.addEventListener('click', function () {
    var current = order.indexOf(root.dataset.theme);
    rotation += 90;
    trigger.style.setProperty('--palette-rotation', rotation + 'deg');
    applyPalette(order[(current + 1) % order.length], true);
  });

  applyPalette(root.dataset.theme || 'paper', false);
}());
