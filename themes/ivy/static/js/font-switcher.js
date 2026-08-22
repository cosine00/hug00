(function () {
  var options = [
    { id: 'zhuque', label: '朱雀仿宋', href: 'https://cdn.jsdelivr.net/npm/@free-fonts/zhuque-fangsong@1.0.0/zhuque-fangsong.css' },
    { id: 'wenkai', label: '霞鹜文楷', href: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/style.css' },
    { id: 'kinghwa', label: '京华老宋', href: 'https://ik.imagekit.io/fonts130/packages/jhlst/dist/%E4%BA%AC%E8%8F%AF%E8%80%81%E5%AE%8B%E4%BD%93v2_002/result.css' },
    { id: 'zhisong', label: '新致宋', href: 'https://fontsapi.zeoseven.com/22/main/result.css' }
  ];

  var button = document.querySelector('.font-trigger');
  var stylesheet = document.getElementById('blog-font-stylesheet');
  if (!button || !stylesheet) return;
  var tooltip = button.querySelector('.control-tooltip');
  var initialIndex = options.findIndex(function (option) {
    return option.id === document.documentElement.dataset.font;
  });
  var rotation = Math.max(0, initialIndex) * 90;
  button.style.setProperty('--font-rotation', rotation + 'deg');

  function currentIndex() {
    var id = document.documentElement.dataset.font || 'zhuque';
    var index = options.findIndex(function (option) { return option.id === id; });
    return index < 0 ? 0 : index;
  }

  function apply(option) {
    document.documentElement.dataset.font = option.id;
    stylesheet.href = option.href;
    if (tooltip) tooltip.textContent = option.label;
    button.setAttribute('aria-label', '当前字体：' + option.label + '，点击切换');
    try { localStorage.setItem('blog-font', option.id); } catch (_) {}
  }

  apply(options[currentIndex()]);
  button.addEventListener('click', function () {
    rotation += 90;
    button.style.setProperty('--font-rotation', rotation + 'deg');
    apply(options[(currentIndex() + 1) % options.length]);
  });
})();
