(function () {
  'use strict';

  var order = ['paper', 'night', 'sepia', 'mist'];
  var palettes = {
    paper: { label: '明亮', color: '#fafafa', dark: false },
    night: { label: '夜幕', color: '#17191d', dark: true },
    sepia: { label: '霜灰', color: '#e7edf1', dark: false },
    mist: { label: '晨曦', color: '#faf6f2', dark: false }
  };
  var root = document.documentElement;
  var trigger = document.querySelector('.palette-trigger');
  if (!trigger) return;
  var tooltip = trigger.querySelector('.control-tooltip');
  var initialIndex = order.indexOf(root.dataset.theme);
  var rotation = Math.max(0, initialIndex) * 90;
  trigger.style.setProperty('--palette-rotation', rotation + 'deg');

  function applyPalette(name, persist) {
    if (!palettes[name]) name = 'paper';
    var palette = palettes[name];
    trigger.dataset.palettePosition = (name === 'night' || name === 'mist') ? 'vertical' : 'horizontal';
    root.dataset.theme = name;
    root.style.colorScheme = palette.dark ? 'dark' : 'light';
    root.classList.toggle('dark', palette.dark);
    document.body.classList.toggle('dark', palette.dark);
    document.body.classList.toggle('dark-theme', palette.dark);
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = palette.color;
    if (tooltip) tooltip.textContent = palette.label;
    trigger.setAttribute('aria-label', '当前色调：' + palette.label + '，点击切换');
    if (persist) localStorage.setItem('blog-palette', name);
    window.dispatchEvent(new CustomEvent('blogpalettechange', {
      detail: { theme: name, dark: palette.dark }
    }));
  }

  /* 换色调时从按钮那儿「涨开」新配色（View Transitions API）。
     不支持、或者在「减少动态效果」下，就老老实实直接换 —— 动画是锦上添花，
     不该成为能不能切色调的前提。 */
  var calmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var revealing = false;

  /** 到视口四个角里最远那个角的距离：圆得这么大才盖得住整屏 */
  function coverRadius(x, y) {
    var dx = Math.max(x, window.innerWidth - x);
    var dy = Math.max(y, window.innerHeight - y);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function revealPalette(apply) {
    if (!document.startViewTransition || calmQuery.matches || revealing) {
      apply();
      return;
    }
    var rect = trigger.getBoundingClientRect();
    // 侧栏收起时按钮没有尺寸，退回屏幕上方中间，总比从左上角涨开自然
    var x = Math.round(rect.width ? rect.left + rect.width / 2 : window.innerWidth / 2);
    var y = Math.round(rect.height ? rect.top + rect.height / 2 : 48);
    var radius = Math.ceil(coverRadius(x, y));

    revealing = true;
    var transition = document.startViewTransition(apply);
    transition.ready.then(function () {
      root.animate(
        {
          clipPath: [
            'circle(0px at ' + x + 'px ' + y + 'px)',
            'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'
          ]
        },
        {
          duration: 520,
          easing: 'cubic-bezier(.65, 0, .35, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    }).catch(function () {
      // 连点、切标签页都会让这次过渡被丢掉；配色已经换好了，不必报错
    });
    transition.finished.finally(function () { revealing = false; });
  }

  trigger.addEventListener('click', function () {
    var current = order.indexOf(root.dataset.theme);
    rotation += 90;
    trigger.style.setProperty('--palette-rotation', rotation + 'deg');
    revealPalette(function () {
      applyPalette(order[(current + 1) % order.length], true);
    });
  });

  applyPalette(root.dataset.theme || 'paper', false);
}());
